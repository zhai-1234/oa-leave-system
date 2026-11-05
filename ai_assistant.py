# -*- coding: utf-8 -*-
"""OA 请假系统 · AI 助手
功能：制度智能问答（向量 RAG）/ 审批合规预审 / 智能填单 / 大模型接入 / 登录鉴权
- 向量检索：默认字符 n-gram TF-IDF + 余弦相似度（离线可用）；配置 embedding 接口后走稠密向量。
- 大模型：OpenAI 兼容接口（通义千问 / DeepSeek / Moonshot 等），配置后自动增强。
- 配置优先级：环境变量 < ai_config.json（POST /api/ai/config 可写入）。
"""
import os
import json
import re
import math
import datetime as dt
from collections import Counter
from pathlib import Path
from urllib import request as urlreq

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "ai_config.json"

# ============ 制度知识库（检索语料，带出处） ============
KNOWLEDGE = [
    dict(title="年休假", question="年休假有几天？如何申请？", answer="按累计工龄：满1年不满10年5天、满10年不满20年10天、20年以上15天；当年新入职按剩余月份折算。原则上提前5个工作日申请，无需证明材料和事由。", keywords=["年休假", "年假", "工龄"], advance=5, proof=False),
    dict(title="事假", question="事假能请几天？", answer="单次原则上不超过3天，年度累计不超过20天；原则上提前1个工作日申请，突发情况及时报备并事后补办；需如实说明事由。", keywords=["事假", "个人事务"], advance=1, proof=False),
    dict(title="丧假", question="丧假几天？要什么材料？", answer="3个自然日；可及时报备申请，紧急时休假结束后补办；需死亡证明、户籍注销证明或亲属关系证明，紧急可后补。", keywords=["丧假", "丧葬"], advance=0, proof=True),
    dict(title="路程假", question="路程假怎么请？", answer="单次原则上不超过3天，须与婚假或丧假连续申请，并说明往返行程和时间。", keywords=["路程假", "路程"], advance=0, proof=True),
    dict(title="育儿假", question="育儿假怎么休？", answer="子女未满3周岁，每年10天，原则不超过2次；提前3个工作日申请；需子女出生医学证明或户口簿（已备案可不重复提交）。", keywords=["育儿假", "子女", "孩子"], advance=3, proof=True),
    dict(title="婚假", question="婚假几天？", answer="3个连续自然日；原则上提前3个工作日申请；需结婚证复印件或其他有效证明，客观原因可后补。", keywords=["婚假", "结婚"], advance=3, proof=True),
    dict(title="产假", question="产假多少天？", answer="98个连续自然日；起始时间由女职工结合身体状况及医疗建议决定；需孕检证明、出生医学证明等，可产后补交。", keywords=["产假", "生育", "怀孕"], advance=None, proof=True),
    dict(title="奖励假", question="奖励假多少天？", answer="80个连续自然日，与产假原则上连续安排；需生育证明，可产后补交。", keywords=["奖励假"], advance=None, proof=True),
    dict(title="妇女节假期", question="妇女节假期怎么安排？", answer="3月8日半天，由公司统一安排，员工无需申请、无需材料。", keywords=["妇女节", "三八"], advance=None, proof=False),
    dict(title="陪产假", question="陪产假几天？", answer="15个连续自然日；原则上提前3个工作日申请，分娩时间不确定可先报备后补办；需配偶生育证明。", keywords=["陪产假", "陪护", "配偶"], advance=3, proof=True),
    dict(title="一次性短期病假", question="短期病假怎么请？", answer="每自然年度一次、2个工作日；当日或最迟次工作日申请；无需证明材料、无需事由。", keywords=["短期病假", "病假", "身体不舒服", "身体不适", "发烧", "感冒", "头疼"], advance=0, proof=False),
    dict(title="护理假", question="护理假几天？", answer="父母满60岁每年5天；住院治疗累计不超15天、不超2次；提前5个工作日申请；需独生子女/计生证明、父母年龄及户籍证明，住院另附医疗材料。", keywords=["护理假", "照顾父母", "父母", "住院"], advance=5, proof=True),
    dict(title="法定病假", question="法定病假怎么请？", answer="计入依法核定的医疗期；当日或最迟次工作日申请，住院急诊可由家属报备后补办；需医疗机构病假证明、诊断或住院证明。", keywords=["法定病假", "病假", "医疗期", "住院"], advance=0, proof=True),
    dict(title="审批时限", question="审批要多久？", answer="通常1个工作日完成；连续或复杂申请原则上不超过2个工作日。", keywords=["审批", "时限", "多久", "几个工作日"], advance=None, proof=False),
    dict(title="突发情况报备", question="突发情况怎么处理？", answer="突发情况可先报备，休假结束后1个工作日内补办；确有障碍的，最迟在障碍消除后3个工作日内完成。", keywords=["突发", "报备", "紧急", "来不及"], advance=None, proof=False),
    dict(title="材料补交", question="材料没准备好怎么办？", answer="无法同步提交材料时，勾选“待补交”并填写预计补交时间。", keywords=["材料", "补交", "待补交", "证明"], advance=None, proof=False),
    dict(title="天数计算", question="请假天数怎么算？", answer="工作日：周一至周五，加调休工作日、扣法定节假日；自然日：结束减开始加1。", keywords=["天数", "计算", "工作日", "自然日", "节假日", "调休"], advance=None, proof=False),
    dict(title="销假与续假", question="可以提前回来或续假吗？", answer="批准后可发起提前返岗（销假）或续假，单独审批并更新假期余额。", keywords=["销假", "续假", "提前返岗", "延长"], advance=None, proof=False),
]

# ============ 配置 ============
def _env_cfg():
    return {
        "llm_api_key": os.environ.get("LLM_API_KEY", "").strip(),
        "llm_base_url": os.environ.get("LLM_BASE_URL", "").strip(),
        "llm_model": os.environ.get("LLM_MODEL", "qwen-plus").strip() or "qwen-plus",
        "embedding_model": os.environ.get("EMBEDDING_MODEL", "text-embedding-v3").strip() or "text-embedding-v3",
        "use_embedding_api": os.environ.get("USE_EMBEDDING_API", "0").strip() in ("1", "true", "True"),
        "embedding_api_key": os.environ.get("EMBEDDING_API_KEY", "").strip(),
        "embedding_base_url": os.environ.get("EMBEDDING_BASE_URL", "").strip(),
    }

def load_config():
    cfg = _env_cfg()
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            for k in cfg:
                if data.get(k) not in (None, ""):
                    cfg[k] = data[k]
        except Exception:
            pass
    return cfg

def save_config(patch):
    cfg = load_config()
    for k in ("llm_api_key", "llm_base_url", "llm_model", "embedding_model", "use_embedding_api", "embedding_api_key", "embedding_base_url"):
        if k in patch and patch[k] is not None:
            cfg[k] = patch[k]
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg

def config_public(cfg=None):
    c = cfg or load_config()
    has = bool(c.get("llm_api_key") and c.get("llm_base_url"))
    emb_key = (c.get("embedding_api_key") or c.get("llm_api_key") or "").strip()
    emb_base = (c.get("embedding_base_url") or c.get("llm_base_url") or "").strip()
    emb_has = bool(emb_key and emb_base and c.get("use_embedding_api"))
    return {
        "llm_base_url": c.get("llm_base_url", ""),
        "llm_model": c.get("llm_model", "qwen-plus"),
        "embedding_model": c.get("embedding_model", "text-embedding-v3"),
        "use_embedding_api": bool(c.get("use_embedding_api")),
        "embedding_base_url": emb_base,
        "llm_configured": has,
        "embedding_configured": emb_has,
        "vector_mode": "embedding-api" if emb_has else "ngram-cosine",
    }

# ============ LLM / Embedding 客户端 ============
def _post(url, payload, key, timeout=30):
    req = urlreq.Request(url, data=json.dumps(payload).encode("utf-8"),
                         headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    with urlreq.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def _chat_payload(model, messages, temperature, response_format=None):
    p = {"model": model, "messages": messages, "temperature": temperature}
    if response_format:
        p["response_format"] = response_format
    return p


def _chat_raw(messages, temperature=0.2, response_format=None):
    cfg = load_config()
    if not (cfg["llm_api_key"] and cfg["llm_base_url"]):
        return False, "未配置 LLM_API_KEY / LLM_BASE_URL"
    try:
        data = _post(cfg["llm_base_url"].rstrip("/") + "/chat/completions",
                     _chat_payload(cfg["llm_model"], messages, temperature, response_format), cfg["llm_api_key"])
        return True, data["choices"][0]["message"]["content"].strip()
    except urlreq.HTTPError as e:
        try:
            body = e.read().decode("utf-8", "ignore")[:300]
        except Exception:
            body = ""
        return False, "HTTP %s：%s" % (e.code, body)
    except Exception as e:
        return False, "%s：%s" % (type(e).__name__, str(e)[:300])

def llm_chat(messages, temperature=0.2):
    ok, content = _chat_raw(messages, temperature)
    return content if ok else None

def llm_embed(texts):
    cfg = load_config()
    key = (cfg.get("embedding_api_key") or cfg.get("llm_api_key") or "").strip()
    base = (cfg.get("embedding_base_url") or cfg.get("llm_base_url") or "").strip().rstrip("/")
    if not (key and base and cfg.get("use_embedding_api")):
        return None
    try:
        data = _post(base + "/embeddings",
                     {"model": cfg["embedding_model"], "input": texts}, key)
        return [d["embedding"] for d in data["data"]]
    except Exception:
        return None

def test_llm():
    ok, content = _chat_raw([{"role": "user", "content": "请只回复两个字：正常"}], temperature=0)
    if ok:
        return {"ok": True, "message": "连接成功", "reply": content}
    return {"ok": False, "message": content}

# ============ 向量检索 ============
def _ngrams(text):
    t = re.sub(r"\s+", "", text or "")
    return [t[i:i + 1] for i in range(len(t))] + [t[i:i + 2] for i in range(max(0, len(t) - 1))]

def _tf(text):
    c = Counter(_ngrams(text))
    total = sum(c.values()) or 1
    return {g: v / total for g, v in c.items()}

_IDF = None
_DOC_VECS = None
_DOC_EMB = None

def _doc_text(k):
    return k["title"] + k["question"] + k["answer"] + "".join(k.get("keywords", []))

def _build_index():
    global _IDF, _DOC_VECS
    if _IDF is not None:
        return
    tfs = []
    df = Counter()
    for k in KNOWLEDGE:
        t = _tf(_doc_text(k))
        tfs.append(t)
        for g in t:
            df[g] += 1
    n = len(KNOWLEDGE)
    _IDF = {g: math.log((n + 1) / (f + 1)) + 1.0 for g, f in df.items()}
    _DOC_VECS = [{g: tf[g] * _IDF.get(g, 1.0) for g in tf} for tf in tfs]

def _sparse_cos(a, b):
    if not a or not b:
        return 0.0
    dot = sum(a[g] * b.get(g, 0.0) for g in a)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0

def _dense_cos(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0

def _doc_embeddings():
    global _DOC_EMB
    if _DOC_EMB is not None:
        return _DOC_EMB
    texts = [_doc_text(k) for k in KNOWLEDGE]
    all_embs = []
    for i in range(0, len(texts), 8):
        chunk = texts[i:i + 8]
        e = llm_embed(chunk)
        if not e or len(e) != len(chunk):
            _DOC_EMB = []
            return _DOC_EMB
        all_embs.extend(e)
    if len(all_embs) == len(KNOWLEDGE):
        _DOC_EMB = list(zip(all_embs, KNOWLEDGE))
    else:
        _DOC_EMB = []
    return _DOC_EMB

def retrieve(q, top_k=3):
    q = q or ""
    if config_public()["vector_mode"] == "embedding-api":
        qemb = llm_embed([q])
        docs = _doc_embeddings()
        if qemb and docs:
            pairs = [(_dense_cos(qemb[0], e), k) for e, k in docs]
            pairs = [(s, k) for s, k in pairs if s > 0]
            pairs.sort(key=lambda x: -x[0])
            if pairs:
                return [k for _, k in pairs[:top_k]], "embedding-api"
    _build_index()
    qv = {g: tf * _IDF.get(g, 1.0) for g, tf in _tf(q).items()}
    pairs = [(_sparse_cos(qv, _DOC_VECS[i]), KNOWLEDGE[i]) for i in range(len(KNOWLEDGE))]
    pairs = [(s, k) for s, k in pairs if s > 0]
    pairs.sort(key=lambda x: -x[0])
    return [k for _, k in pairs[:top_k]], "ngram-cosine"

# ============ 功能1：制度问答 ============
# 制度类问句优先放行给检索，避免“是/什么/还能/区别”这类问法被误判成个人查询。
_POLICY_ASK = re.compile(r"还能|能不能|可以吗|区别|什么是|是什么|是不是|怎么算|怎么请|要什么|需要什么|规定|标准|吗[？?]?\s*$")
# 余额类提问带「余额/还剩/剩余/还有多少天」等状态词即可，不必带第一人称；
# 记录类提问仍要求第一人称，避免“请了病假还能请年假吗”这类制度问句被劫持。
_ASK_BALANCE = re.compile(r"余额|还剩|剩余|(还有|剩)[^。？?]{0,3}(多少|几)|(我|本人)[^。？?]{0,8}(还有|剩|余额|剩余|有多少|多少天|几天)")
_ASK_USED = re.compile(r"(我|本人)[^。？?]{0,6}(请了|申请了|用了|休了)|请假记录|请假内容")
# 历史申请单里写的是“病假”，余额与制度里的键是拆分后的两个假种。
_TYPE_ALIAS = {"病假": "法定病假"}


def _personal_types(q):
    """从问题中确定要回答的假种；病假对应余额里两个独立假种，需同时返回。"""
    if any(w in q for w in ("法定病假", "医疗期")):
        return ["法定病假"]
    if "短期病假" in q or "一次性短期病假" in q:
        return ["一次性短期病假"]
    if any(w in q for w in ("病假", "生病", "不舒服")):
        return ["一次性短期病假", "法定病假"]
    titles = []
    for k in KNOWLEDGE:
        for kw in k["keywords"]:
            if kw and kw in q:
                titles.append(k["title"])
                break
    return titles


def _personal_answer(q, user):
    """识别“查询本人假期情况”的意图并回答；非个人查询返回 None。"""
    if not user:
        return None
    q = q or ""
    if _POLICY_ASK.search(q):
        return None
    want_balance = bool(_ASK_BALANCE.search(q))
    want_used = bool(_ASK_USED.search(q))
    if not (want_balance or want_used):
        return None
    import server as legacy
    conn = legacy.db()
    try:
        balances = {r["leave_type"]: r["remaining_days"] for r in conn.execute(
            "SELECT leave_type, remaining_days FROM leave_balances WHERE user_id=?", (user["id"],))}
        year = str(dt.date.today().year)
        rows = [dict(r) for r in conn.execute(
            "SELECT leave_type, days, reason, start_time, end_time FROM leave_requests WHERE user_id=? AND substr(start_time,1,4)=? AND status='approved' ORDER BY start_time",
            (user["id"], year))]
    finally:
        conn.close()
    for r in rows:
        r["leave_type"] = _TYPE_ALIAS.get(r["leave_type"], r["leave_type"])
    types = _personal_types(q)
    shown = [r for r in rows if r["leave_type"] in types] if types else rows
    lines = []
    if want_balance:
        if types:
            for t in types:
                used = sum(r["days"] for r in rows if r["leave_type"] == t)
                lines.append("你的「%s」剩余 %.1f 天，今年已用 %.1f 天。" % (t, balances.get(t, 0.0), used))
        else:
            items = "；".join("%s %.1f 天" % (k, v) for k, v in sorted(balances.items()) if float(v) > 0)
            lines.append("你当前的假期余额：" + (items or "暂无可用假期。"))
    if want_used:
        total = sum(r["days"] for r in shown)
        scope = "、".join(types) if types else "全部"
        lines.append("今年（%s）已批准的「%s」请假共 %.1f 天、%d 条：" % (year, scope, total, len(shown)))
        for r in shown:
            lines.append("- %s：%s ~ %s，%.1f 天，事由：%s" % (r["leave_type"], r["start_time"][:10], r["end_time"][:10], r["days"], r["reason"] or "无"))
    if not lines:
        return None
    answer = "\n".join(lines)
    srcs = types if types else (["假期余额"] if want_balance else ["请假记录"])
    return {"mode": "rule", "kind": "personal", "answer": answer, "sources": srcs}


def qa(question, user=None):
    personal = _personal_answer(question, user)
    if personal:
        return personal
    expanded = None
    if any(w in question for w in ("法定病假", "医疗期")):
        expanded = [k for k in KNOWLEDGE if k["title"] == "法定病假"]
    elif any(w in question for w in ("短期病假", "一次性短期病假")):
        expanded = [k for k in KNOWLEDGE if k["title"] == "一次性短期病假"]
    elif any(w in question for w in ("病假", "生病", "不舒服")):
        expanded = [k for k in KNOWLEDGE if k["title"] in ("一次性短期病假", "法定病假")]
    if expanded:
        hits, mode = expanded, "keyword-expanded"
    else:
        hits, mode = retrieve(question, 3)
    if not hits:
        return {"mode": "rule", "vector_mode": mode, "answer": "未在制度知识库中找到相关内容，请换个问法（例如：婚假要提前几天申请、需要什么材料）。", "sources": []}
    srcs = [h["title"] for h in hits]
    if expanded is not None:
        answer = "\n".join("【%s】%s" % (h["title"], h["answer"]) for h in hits)
        return {"mode": "rule", "vector_mode": mode, "answer": answer, "sources": srcs}
    ctx = "\n".join("【%s】%s" % (h["title"], h["answer"]) for h in hits)
    ans = llm_chat([
        {"role": "system", "content": "你是公司OA请假制度助手。只依据给定制度作答，并在结尾标注制度名称；不要编造。"},
        {"role": "user", "content": "制度资料：\n%s\n\n问题：%s" % (ctx, question)},
    ])
    if ans:
        if expanded:
            missing = [h for h in hits if h["title"] not in ans]
            if missing:
                ans += "\n\n" + "\n".join("【%s】%s" % (h["title"], h["answer"]) for h in missing)
        return {"mode": "llm", "vector_mode": mode, "answer": ans, "sources": srcs}
    answer = "\n".join("【%s】%s" % (h["title"], h["answer"]) for h in hits)
    r = {"mode": "rule", "vector_mode": mode, "answer": answer, "sources": srcs}
    if _llm_enabled():
        r["llm_fallback"] = True
    return r

# ============ 功能2：审批合规预审 ============
def legacy_policy(lt):
    try:
        import server as legacy
        return legacy.LEAVE_POLICIES.get(lt, {})
    except Exception:
        return {}


def _make_risk(code, level, message, policy_text):
    return {"code": code, "level": level, "message": message, "policy": policy_text}


def _build_review(lt, req, policy, remaining, advance_required, advance_actual, employee=None, conn=None):
    risks = []
    details = []

    def add(code, level, message):
        risks.append(message)
        details.append(_make_risk(code, level, message, policy.get("limit") or lt or ""))

    try:
        days = float(req.get("days") or 0)
    except (TypeError, ValueError):
        days = 0.0
    reason = (req.get("reason") or "").strip()
    material_status = (req.get("material_status") or "").strip()
    material_note = (req.get("material_note") or "").strip()
    emergency_report = bool(req.get("emergency_report"))
    start_text = (req.get("start_time") or "").strip()
    end_text = (req.get("end_time") or "").strip()

    start_dt = end_dt = None
    date_ok = True
    try:
        start_dt = dt.datetime.fromisoformat(start_text.replace("T", " "))
        end_dt = dt.datetime.fromisoformat(end_text.replace("T", " "))
    except Exception:
        date_ok = False
        add("DATE_INVALID", "high", "请假日期无法解析，请人工核对")
    if date_ok and end_dt < start_dt:
        date_ok = False
        add("DATE_ORDER", "high", "结束时间早于开始时间")

    max_per = policy.get("max_per_request")
    if max_per is not None and days > float(max_per):
        add("MAX_PER_REQUEST", "high", "单次申请超过该假种单次上限 %s 天" % _fmt_num(max_per))

    if conn is not None and req.get("user_id") is not None:
        year_start = dt.date.today().replace(month=1, day=1).isoformat() + " 00:00:00"
        annual_limit = policy.get("annual_limit")
        if annual_limit is not None:
            try:
                used_row = conn.execute(
                    "SELECT COALESCE(SUM(days),0) FROM leave_requests WHERE user_id=? AND leave_type=? AND status IN ('approved','pending','reported','supplement_required') AND start_time>=? AND id<>?",
                    (req["user_id"], lt, year_start, req.get("id")),
                ).fetchone()
                used = float(used_row[0] or 0) if used_row else 0.0
                if used + days > float(annual_limit):
                    add("ANNUAL_LIMIT", "high", "年度累计将超过额度：已用 %s 天，本次 %s 天，上限 %s 天" % (_fmt_num(used), _fmt_num(days), _fmt_num(annual_limit)))
            except Exception:
                pass
        max_uses = policy.get("max_uses")
        if max_uses is not None:
            try:
                used_count = conn.execute(
                    "SELECT COUNT(*) FROM leave_requests WHERE user_id=? AND leave_type=? AND status IN ('approved','pending','reported','supplement_required') AND start_time>=? AND id<>?",
                    (req["user_id"], lt, year_start, req.get("id")),
                ).fetchone()[0]
                if int(used_count or 0) >= int(max_uses):
                    add("MAX_USES", "high", "该假种已达到年度使用次数上限 %s 次" % max_uses)
            except Exception:
                pass

    if advance_required is not None:
        if advance_actual is None:
            add("ADVANCE_UNKNOWN", "medium", "无法计算提前申请量，请人工核实")
        else:
            try:
                actual = float(advance_actual)
            except (TypeError, ValueError):
                actual = None
            if actual is not None and actual < float(advance_required):
                msg = "提前申请不足：要求提前 %s 个工作日，实际 %s 个工作日" % (_fmt_num(advance_required), _fmt_num(actual))
                if emergency_report:
                    msg += "；已勾选突发报备"
                    add("ADVANCE_SHORT", "medium", msg)
                else:
                    add("ADVANCE_SHORT", "high", msg)

    if remaining is not None and days > float(remaining):
        add("BALANCE_SHORT", "high", "余额不足：可用 %s 天，本次申请 %s 天" % (_fmt_num(remaining), _fmt_num(days)))

    if policy.get("proof") and material_status != "complete" and not material_note:
        add("MATERIAL_MISSING", "medium", "该假种需要证明材料，请确认已提交或填写“待补交”说明")

    if lt == "事假" and not reason:
        add("REASON_MISSING", "medium", "事假需如实说明事由")

    if reason:
        reason_valid, reason_note = _reason_check(reason, lt, reason, employee)
        if reason_valid == "不合理":
            add("REASON_INVALID", "high", "请假事由不合理：" + (reason_note or "请补充具体说明"))
        elif reason_valid == "存疑":
            add("REASON_UNCERTAIN", "medium", "请假事由存疑：" + (reason_note or "请人工确认"))

    if employee:
        gender = (employee.get("gender") or "").strip()
        if lt in ("产假", "奖励假") and gender and gender != "女":
            add("GENDER_MISMATCH", "high", "该假种仅适用于符合条件的女性员工")
        if lt == "陪产假" and gender and gender != "男":
            add("GENDER_MISMATCH", "high", "陪产假仅适用于符合条件的男性员工")

    if lt == "路程假":
        related_no = (req.get("related_request_no") or "").strip()
        if not related_no:
            add("RELATED_MISSING", "medium", "路程假必须关联本人婚假或丧假申请")
        elif conn is not None and req.get("user_id") is not None:
            rel = conn.execute(
                "SELECT leave_type, end_time FROM leave_requests WHERE request_no=? AND user_id=?",
                (related_no, req["user_id"]),
            ).fetchone()
            if not rel:
                add("RELATED_INVALID", "high", "关联申请不存在或不属于该员工")
            elif rel["leave_type"] not in ("婚假", "丧假"):
                add("RELATED_INVALID", "high", "关联申请必须是婚假或丧假")
            elif start_dt:
                try:
                    rel_end = dt.datetime.fromisoformat((rel["end_time"] or "").replace("T", " "))
                    if start_dt.date() != rel_end.date() + dt.timedelta(days=1):
                        add("RELATED_DISCONTINUOUS", "medium", "路程假应与关联婚假/丧假连续安排")
                except Exception:
                    pass

    history_count = 0
    if conn is not None and req.get("user_id") is not None:
        history_count = conn.execute(
            "SELECT COUNT(*) FROM leave_requests WHERE user_id=? AND leave_type=? AND status='approved'",
            (req.get("user_id"), lt),
        ).fetchone()[0]

    if conn is not None and req.get("user_id") is not None and req.get("id") is not None and date_ok:
        overlaps = conn.execute(
            "SELECT request_no, leave_type, start_time, end_time FROM leave_requests "
            "WHERE user_id=? AND id<>? AND status IN ('pending','reported','supplement_required','approved') "
            "AND NOT (end_time<=? OR start_time>=?) ORDER BY start_time LIMIT 3",
            (req.get("user_id"), req.get("id"), start_text, end_text),
        ).fetchall()
        if overlaps:
            first = overlaps[0]
            add("OVERLAP", "high", "与申请单 %s（%s）时间重叠" % (first["request_no"], first["leave_type"]))

    score = 100
    for item in details:
        if item["level"] == "high":
            score -= 25
        elif item["level"] == "medium":
            score -= 12
        else:
            score -= 6
    score = max(0, score)

    high_count = sum(1 for x in details if x["level"] == "high")
    medium_count = sum(1 for x in details if x["level"] == "medium")
    if details:
        verdict = "不通过" if high_count else "需关注"
    else:
        verdict = "通过"

    if verdict == "不通过":
        suggested_action = "退回修改"
        comment_draft = "预审不通过：" + "；".join(x["message"] for x in details if x["level"] == "high")
    elif verdict == "需关注":
        suggested_action = "人工复核后决定"
        comment_draft = "预审需关注：" + "；".join(x["message"] for x in details)
    else:
        suggested_action = "可进入人工通过流程"
        comment_draft = "未发现明显合规问题，建议按流程审批。"

    summary = "发现 %d 项风险（高风险 %d 项、中风险 %d 项）：%s" % (
        len(details), high_count, medium_count, "；".join(risks)
    ) if details else "未发现明显合规问题，建议人工复核材料与余额。"

    mode = "rule"
    if _llm_enabled():
        ans = llm_chat([
            {"role": "system", "content": "你是审批合规助手，用一句话总结预审风险并给出结论，不要编造制度。"},
            {"role": "user", "content": "假种：%s；风险：%s" % (lt, "；".join(risks) if risks else "无")},
        ], temperature=0)
        if ans:
            summary = ans
            mode = "llm"

    report = {
        "mode": mode,
        "verdict": verdict,
        "score": score,
        "summary": summary,
        "risk_items": risks,
        "risk_details": details,
        "policy": lt,
        "suggested_action": suggested_action,
        "comment_draft": comment_draft,
        "high_risk_count": high_count,
        "medium_risk_count": medium_count,
        "check_count": len(details),
        "history_count": history_count,
    }
    if mode == "rule" and _llm_enabled():
        report["llm_fallback"] = True
    return report


def review(data):
    lt = (data.get("leave_type") or "").strip()
    k = next((x for x in KNOWLEDGE if x["title"] == lt), None)
    if not k:
        return {
            "mode": "rule", "verdict": "需人工确认", "score": 0,
            "summary": "未识别到该假种，请人工核对制度。",
            "risk_items": ["假种未知"],
            "risk_details": [{"code": "UNKNOWN_TYPE", "level": "high", "message": "假种未知", "policy": ""}],
            "suggested_action": "人工核对假种",
            "comment_draft": "未识别到该假种，请人工核对制度。",
        }
    req = {
        "leave_type": lt,
        "days": data.get("days"),
        "reason": data.get("reason") or "",
        "material_status": data.get("material_status") or "complete",
        "material_note": data.get("material_note") or "",
        "emergency_report": bool(data.get("emergency_report")),
        "related_request_no": data.get("related_request_no") or "",
    }
    return _build_review(
        lt=lt,
        req=req,
        policy=legacy_policy(lt),
        remaining=data.get("available_balance"),
        advance_required=k.get("advance"),
        advance_actual=data.get("advance_days"),
        employee=None,
        conn=None,
    )


# ============ 功能3：智能填单 ============
_WD = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6, "末": 6}

def _weekday_in_week(today, wd, week=0):
    this_monday = today - dt.timedelta(days=today.weekday())
    return this_monday + dt.timedelta(days=week * 7 + wd)


def _resolve_weekday(today, wd, week):
    d = _weekday_in_week(today, wd, week)
    if week == 0 and d < today:
        d = _weekday_in_week(today, wd, 1)
    return d


def _next_weekday(base, wd):
    return base + dt.timedelta(days=(wd - base.weekday()) % 7)

def _match_candidates(text):
    scored = []
    for k in KNOWLEDGE:
        if k["title"] not in LEAVE_TYPES:
            continue
        matches = []
        if k["title"] in text:
            matches.append(k["title"])
        for kw in k.get("keywords", []):
            if kw and kw in text:
                matches.append(kw)
        if matches:
            scored.append((k, max(len(m) for m in matches)))
    if not scored:
        return []
    best = max(length for _, length in scored)
    seen = set()
    out = []
    for k, length in scored:
        if length == best and k["title"] not in seen:
            seen.add(k["title"])
            out.append(k)
    return out


def _suggest_options(text, cands):
    base = "你提到的需求可能对应多种假种：\n" + "\n".join("%s：%s" % (k["title"], k["answer"]) for k in cands)
    if any(w in text for w in ("病", "不舒服", "头晕", "发烧", "住院")):
        base += "\n建议：轻微不适可用「一次性短期病假」（无需证明）；较严重或需住院用「法定病假」；若只是想休息、年假额度也够，可考虑更宽松的「年休假」。"
    ans = llm_chat([
        {"role": "system", "content": "你是贴心的请假助手。针对用户需求和可选假种，给出简明建议：说明各假种区别、分别适合哪种情况，并推荐更宽松的替代假种；语气自然不呆板，最后请用户选择。"},
        {"role": "user", "content": "用户需求：%s\n可选假种：\n%s" % (text, base)},
    ], temperature=0.3)
    return ans if ans else base


LEAVE_TYPES = ["年休假", "事假", "丧假", "路程假", "育儿假", "婚假", "产假", "奖励假", "妇女节假期", "陪产假", "一次性短期病假", "护理假", "法定病假"]


def _leave_type_options():
    return [k for k in KNOWLEDGE if k["title"] in LEAVE_TYPES]


RELATED = {
    "年休假": ["事假", "一次性短期病假"],
    "事假": ["年休假", "一次性短期病假"],
    "婚假": ["路程假", "年休假"],
    "丧假": ["路程假", "事假"],
    "路程假": ["婚假", "丧假"],
    "育儿假": ["护理假", "事假"],
    "产假": ["奖励假", "法定病假"],
    "奖励假": ["产假"],
    "妇女节假期": [],
    "陪产假": ["事假", "年休假"],
    "一次性短期病假": ["法定病假", "年休假"],
    "护理假": ["育儿假", "事假"],
    "法定病假": ["一次性短期病假", "年休假"],
}


def _alternatives(user, lt):
    if not user:
        return []
    cands = RELATED.get(lt, [])
    if not cands:
        return []
    try:
        import server as legacy
        conn = legacy.db()
        rows = conn.execute("SELECT leave_type FROM leave_balances WHERE user_id=? AND remaining_days>0", (user["id"],)).fetchall()
        conn.close()
        have = {r["leave_type"] for r in rows}
        return [t for t in cands if t in have]
    except Exception:
        return []


def _clean_reason_fragment(t):
    t = t or ""
    t = re.sub(r"^(?:帮我|我想|我要|我想请|我要请|帮我请|请|申请)+", "", t)
    t = re.sub(r"^(?:一个|一下|半天|几天|一天|两天|请个|休个|个)+", "", t)
    t = re.sub(r"(?:的假|请假|假期|休假|假)+$", "", t)
    t = re.sub(r"[\s,，。！？、：；…~—]+", "", t)
    return t


def _available_balances(user):
    if not user or not user.get("id"):
        return {}
    try:
        import server as legacy
        conn = legacy.db()
        rows = conn.execute("SELECT leave_type, remaining_days FROM leave_balances WHERE user_id=?", (user["id"],)).fetchall()
        conn.close()
        return {r["leave_type"]: float(r["remaining_days"] or 0) for r in rows}
    except Exception:
        return {}


def _fmt_num(n):
    return ("%g" % n) if n is not None else ""


def _recommend_for_time_range(user, start, end, days):
    day_count = days if days is not None else ((end - start).days + 1)
    try:
        import server as legacy
    except Exception:
        legacy = None
    balances = _available_balances(user)
    gender = (user or {}).get("gender", "")
    cands = []
    for lt in LEAVE_TYPES:
        policy = {}
        if legacy is not None:
            policy = legacy.LEAVE_POLICIES.get(lt, {})
        if policy.get("application_required") is False:
            continue
        if lt in ("产假", "奖励假") and gender and gender != "女":
            continue
        if lt == "陪产假" and gender and gender != "男":
            continue
        max_per = policy.get("max_per_request")
        if max_per is not None and float(day_count or 0) > float(max_per):
            continue
        bal = balances.get(lt) if balances else None
        if bal is not None and bal < float(day_count or 0):
            continue
        k = next((x for x in KNOWLEDGE if x["title"] == lt), None)
        cands.append({"leave_type": lt, "guidance": k["answer"] if k else "", "balance": bal})

    if not cands:
        suggestion = "没有找到可满足 %s 天连续休假的假期。请减少天数，或补充具体假种和事由。" % _fmt_num(day_count)
        follow_up = "请告诉我你想请什么假、原因是什么。"
        return [], suggestion, follow_up

    def rank(c):
        lt = c["leave_type"]
        if lt == "年休假":
            return 0
        if lt == "事假":
            return 1
        if lt == "一次性短期病假":
            return 2
        if lt == "法定病假":
            return 3
        return 4
    cands.sort(key=lambda c: (rank(c), -(c["balance"] if c["balance"] is not None else 0)))
    opts = [{"leave_type": c["leave_type"], "guidance": c["guidance"], "primary": (i == 0)} for i, c in enumerate(cands[:5])]
    first = cands[0]
    suggestion = "你这次请假 %s 天，优先推荐「%s」" % (_fmt_num(day_count), first["leave_type"])
    if first["balance"] is not None:
        suggestion += "，当前余额 %s 天" % _fmt_num(first["balance"])
    suggestion += "。"
    others = [c["leave_type"] for c in cands[1:4]]
    if others:
        suggestion += "其他可选：%s。" % "、".join(others)
    follow_up = "你还没指定假种，点击下方选项即可继续；也可以补充请假原因，我再帮你判断。"
    return opts, suggestion, follow_up


_SYMPTOM_REASON_KEYWORDS = {"身体不舒服", "身体不适", "发烧", "感冒", "头疼"}


def _extract_details(text, lt):
    t = text or ""
    t = re.sub(r"\d{1,2}月\d{1,2}日(?:到\d{1,2}月\d{1,2}日)?", "", t)
    t = re.sub(r"(?:下|本|这)?(?:周|星期|礼拜)[一二三四五六日天](?:到(?:周|星期|礼拜)?[一二三四五六日天])?", "", t)
    t = re.sub(r"(?:明天|明日|后天|大后天|今天)", "", t)
    if lt:
        t = t.replace(lt, "")
    for k in KNOWLEDGE:
        if k["title"] not in LEAVE_TYPES:
            continue
        for kw in k.get("keywords", []):
            if kw and kw in t and kw not in _SYMPTOM_REASON_KEYWORDS:
                t = t.replace(kw, "")
    # 只剥离句首意图词，不再全局删“想/要/休/了/请”等会组成事由的字
    t = _clean_reason_fragment(t)
    emergency_report = any(w in text for w in ("报备", "突发", "紧急", "来不及", "事后补"))
    pending_material = any(w in text for w in ("后补", "待补", "补交", "还没", "之后补", "没准备", "未通过", "没通过", "审核通过"))
    return (t if len(t) >= 2 else ""), emergency_report, pending_material


def _rule_extract(text):
    today = dt.date.today()
    cands = _match_candidates(text)
    lt = None
    ambiguous = False
    if len(cands) == 1:
        lt = cands[0]["title"]
    elif len(cands) > 1:
        ambiguous = True
    start = end = None
    m = re.search(r"(\d{1,2})月(\d{1,2})日?到(\d{1,2})月(\d{1,2})日", text)
    if m:
        start = dt.date(today.year, int(m.group(1)), int(m.group(2)))
        end = dt.date(today.year, int(m.group(3)), int(m.group(4)))
    else:
        m = re.search(r"(\d{1,2})月(\d{1,2})日", text)
        if m:
            start = dt.date(today.year, int(m.group(1)), int(m.group(2)))
            end = start
    if start is None:
        week = 1 if ("下周" in text or "下星期" in text or "下个星期" in text) else 0
        if "明天" in text or "明日" in text:
            start = end = today + dt.timedelta(days=1)
        elif "后天" in text:
            start = end = today + dt.timedelta(days=2)
        elif "大后天" in text:
            start = end = today + dt.timedelta(days=3)
        elif "今天" in text:
            start = end = today
        else:
            m = re.search(r"(?:周|星期|礼拜)([一二三四五六日天])", text)
            if m:
                start = _resolve_weekday(today, _WD[m.group(1)], week)
                end = start
                m2 = re.search(r"到(?:周|星期|礼拜)?([一二三四五六日天])", text)
                if m2:
                    end = _next_weekday(start, _WD[m2.group(1)])
    half = ("半天" in text) or ("0.5天" in text)
    days = None
    if start and end:
        days = (end - start).days + 1
        if half:
            days = 0.5
    reason, emergency_report, pending_material = _extract_details(text, lt)
    return {"lt": lt, "ambiguous": ambiguous, "cands": cands, "start": start, "end": end,
            "half": half, "days": days, "reason": reason, "emergency_report": emergency_report,
            "pending_material": pending_material}


_BAD_REASONS = ["不想上班", "不想去", "就是不想", "懒得去", "懒得", "随便吧", "爱咋咋地", "不想干", "不想工作", "不想起床", "摆烂", "躺平", "起不来", "不想动", "无聊到爆"]


def _reason_check(text, lt, reason, user):
    r = (reason or "").strip()
    if not r:
        return ("合理", "")
    for bad in _BAD_REASONS:
        if bad in r or bad in (text or ""):
            return ("不合理", "事由过于随意，请补充具体说明")
    if _llm_enabled():
        try:
            ok, content = _chat_raw([
                {"role": "system", "content": "你是请假事由审核助手。判断这条请假事由是否合理，只输出 JSON：{\"valid\":\"合理|存疑|不合理\",\"note\":\"一句话原因\"}"},
                {"role": "user", "content": "假种：%s；请假事由：%s" % (lt or "未知", r)},
            ], temperature=0, response_format={"type": "json_object"})
            if ok:
                d = json.loads(content)
                valid = d.get("valid", "存疑")
                if valid not in ("合理", "存疑", "不合理"):
                    valid = "存疑"
                return (valid, d.get("note", ""))
        except Exception:
            pass
    if len(re.sub(r"\s+", "", r)) < 2:
        return ("存疑", "事由过短，请补充说明")
    return ("合理", "")


def _llm_enabled():
    c = load_config()
    return bool(c.get("llm_api_key") and c.get("llm_base_url"))


def _llm_extract(text):
    cfg = load_config()
    if not (cfg["llm_api_key"] and cfg["llm_base_url"]):
        return None
    today = dt.date.today()
    tomorrow = (today + dt.timedelta(days=1)).isoformat()
    this_monday = today - dt.timedelta(days=today.weekday())
    next_monday = this_monday + dt.timedelta(days=7)
    next_monday_iso = next_monday.isoformat()
    next_wed = (next_monday + dt.timedelta(days=2)).isoformat()
    next_fri = (next_monday + dt.timedelta(days=4)).isoformat()
    types = "、".join(LEAVE_TYPES)
    weekday_cn = "一二三四五六日"[today.weekday()]
    system = (
        "你是请假信息抽取助手。请从用户输入中抽取请假信息，只输出一个 JSON 对象，不要输出解释或 Markdown。\n"
        "今天是 %s（星期%s）。\n"
        "候选假种：%s。\n"
        "输出字段：leave_type(候选假种之一，识别不出为空字符串)、start_date(YYYY-MM-DD，识别不出为空字符串)、end_date(YYYY-MM-DD，识别不出为空字符串)、days(数字，识别不出为0)、half_day(布尔)、reason(请假事由，没有为空字符串)、emergency_report(布尔)、pending_material(布尔)、confidence(0到1)。\n"
        "规则：\n"
        "1. 假种必须从候选假种中选，口语别名归一化（年假=年休假、短期病假=一次性短期病假）。\n"
        "2. 日期按今天是%s换算；下周X以下周一（%s）为基准；明天/后天/今天按自然日；X月X日按今年。\n"
        "3. 出现报备/突发/紧急/来不及则 emergency_report=true；出现补交/后补/待补/还没/没审核通过则 pending_material=true。\n"
        "4. reason 只保留真正的请假原因，去掉帮我/请/我想/我要等指令词，没有则为空字符串。\n"
        "5. 无法确定就留空/0/false。"
        "6. 如果用户只说了时间和“请假/请个假”，没有明确假种和具体事由，leave_type、reason 都返回空字符串，confidence 不超过 0.45。"
        % (today.isoformat(), weekday_cn, types, today.isoformat(), next_monday_iso)
    )
    messages = [{"role": "system", "content": system}]
    examples = [
        ("明天请事假去银行办事", {"leave_type": "事假", "start_date": tomorrow, "end_date": tomorrow, "days": 1, "half_day": False, "reason": "去银行办事", "emergency_report": False, "pending_material": False, "confidence": 0.95}),
        ("下周三到周五休年假", {"leave_type": "年休假", "start_date": next_wed, "end_date": next_fri, "days": 3, "half_day": False, "reason": "", "emergency_report": False, "pending_material": False, "confidence": 0.95}),
        ("帮我请一个下周一到周五的假", {"leave_type": "", "start_date": next_monday_iso, "end_date": next_fri, "days": 5, "half_day": False, "reason": "", "emergency_report": False, "pending_material": False, "confidence": 0.4}),
    ]
    for q, a in examples:
        messages.append({"role": "user", "content": "输入：" + q})
        messages.append({"role": "assistant", "content": json.dumps(a, ensure_ascii=False)})
    messages.append({"role": "user", "content": "输入：" + text})
    ok, content = _chat_raw(messages, temperature=0, response_format={"type": "json_object"})
    if not ok:
        return None
    try:
        d = json.loads(content)
    except Exception:
        return None
    if not isinstance(d, dict):
        return None
    lt = (d.get("leave_type") or "").strip()
    if lt not in LEAVE_TYPES:
        cands = _match_candidates(lt)
        if len(cands) == 1:
            lt = cands[0]["title"]
        else:
            return None
    start = end = None
    try:
        if d.get("start_date"):
            start = dt.date.fromisoformat(str(d["start_date"])[:10])
        if d.get("end_date"):
            end = dt.date.fromisoformat(str(d["end_date"])[:10])
    except Exception:
        return None
    if start and end and end < start:
        start, end = end, start
    half = bool(d.get("half_day"))
    days = None
    if start and end:
        days = (end - start).days + 1
        if half:
            days = 0.5
    reason = (d.get("reason") or "").strip()
    emergency_report = bool(d.get("emergency_report"))
    pending_material = bool(d.get("pending_material"))
    try:
        conf = float(d.get("confidence"))
    except Exception:
        conf = 0.5
    cands = [k for k in KNOWLEDGE if k["title"] == lt]
    return {"lt": lt, "ambiguous": False, "cands": cands, "start": start, "end": end,
            "half": half, "days": days, "reason": reason, "emergency_report": emergency_report,
            "pending_material": pending_material, "confidence": conf, "mode": "llm"}


def parse_leave(text, user=None):
    text = text or ""
    ext = _llm_extract(text)
    if ext is None:
        ext = _rule_extract(text)
    lt = ext["lt"]
    ambiguous = ext["ambiguous"]
    cands = ext["cands"]
    start = ext["start"]
    end = ext["end"]
    half = ext["half"]
    days = ext["days"]
    reason = _clean_reason_fragment(ext["reason"])
    emergency_report = ext["emergency_report"]
    pending_material = ext["pending_material"]

    used_llm = ext.get("mode") == "llm"
    res = {"text": text, "leave_type": lt, "half_day": half, "extract_mode": ("llm" if used_llm else "rule")}
    if used_llm:
        base_conf = float(ext.get("confidence", 0.5))
    else:
        base_conf = 0.9 if (lt and start) else (0.7 if lt else (0.5 if ambiguous else 0.3))
        if _llm_enabled():
            res["llm_fallback"] = True

    if ambiguous:
        res["ambiguous"] = True
        res["options"] = [{"leave_type": k["title"], "guidance": k["answer"], "primary": (i == 0)} for i, k in enumerate(cands)]
        res["suggestion"] = _suggest_options(text, cands)
        res["follow_up"] = "请选择一种假种，或补充说明病情严重程度/是否需要住院。"
    elif lt:
        k = next((x for x in KNOWLEDGE if x["title"] == lt), None)
        opts = []
        if k:
            res["guidance"] = k["answer"]
            res["material_required"] = bool(k.get("proof"))
            opts.append({"leave_type": lt, "guidance": k["answer"], "primary": True})
        alts = _alternatives(user, lt)
        for a in alts[:3]:
            ak = next((x for x in KNOWLEDGE if x["title"] == a), None)
            if ak:
                opts.append({"leave_type": a, "guidance": ak["answer"], "primary": False})
        if opts:
            res["options"] = opts
        if alts:
            res["suggestion"] = "你也可以考虑：%s。" % "、".join(alts[:3])
    else:
        res["ambiguous"] = True
        if start and end:
            opts, suggestion, follow_up = _recommend_for_time_range(user, start, end, days)
            res["options"] = opts
            res["suggestion"] = suggestion
            res["follow_up"] = follow_up
        else:
            opts = _leave_type_options()
            res["options"] = [{"leave_type": k["title"], "guidance": k["answer"], "primary": False} for k in opts]
            res["suggestion"] = "请告诉我假种和时间，我可以帮你推荐。"
            res["follow_up"] = "例如：下周三到周五休年假；或先选择上方假种。"

    if start:
        res["start_date"] = start.isoformat()
        res["start_time"] = start.isoformat() + (" 09:00" if not half else " 09:00")
    if end:
        res["end_date"] = end.isoformat()
        res["end_time"] = end.isoformat() + (" 18:00" if not half else " 12:00")
    if days is not None:
        res["days"] = days
    if lt and not start:
        res["follow_up"] = "想从哪个日期开始请假？要请几天？"

    reason_required = True
    if lt:
        try:
            import server as legacy
            reason_required = legacy.LEAVE_POLICIES.get(lt, {}).get("reason_required") is not False
        except Exception:
            reason_required = True
        res["reason_required"] = reason_required

    res["reason"] = reason
    res["emergency_report"] = emergency_report
    res["pending_material"] = pending_material
    if emergency_report:
        res["emergency_reason"] = reason
    if pending_material:
        res["material_note"] = reason

    reason_valid = None
    if reason:
        reason_valid, reason_note = _reason_check(text, lt, reason, user)
        res["reason_valid"] = reason_valid
        if reason_note:
            res["reason_note"] = reason_note

    cap = 1.0
    if not lt:
        cap = min(cap, 0.45)
    if not (start and end):
        cap = min(cap, 0.45)
    if ambiguous:
        cap = min(cap, 0.55)
    if lt and reason_required and not reason:
        cap = min(cap, 0.55)
    if reason_valid == "不合理":
        cap = min(cap, 0.35)
    elif reason_valid == "存疑":
        cap = min(cap, 0.55)
    res["confidence"] = round(max(0.0, min(1.0, min(base_conf, cap))), 2)

    res["complete"] = bool(lt and start and (not reason_required or bool(reason)))
    return res



def status():
    pub = config_public()
    return {
        "llm_configured": pub["llm_configured"],
        "vector_mode": pub["vector_mode"],
        "embedding_configured": pub["embedding_configured"],
        "knowledge_entries": len(KNOWLEDGE),
        "version": "2026-09-13.r4",
    }



def review_request(request_id, user):
    """读取真实申请单 + 余额 + 制度，生成审批预审报告（人机协同，AI 只辅助）。"""
    import server as legacy
    conn = legacy.db()
    try:
        req = conn.execute("SELECT * FROM leave_requests WHERE id=?", (request_id,)).fetchone()
        if not req:
            return {"error": "申请不存在"}
        req = dict(req)
        if user.get("role") != "approver" and req.get("user_id") != user.get("id"):
            return {"error": "无权查看该申请"}

        lt = req.get("leave_type") or ""
        policy = legacy.LEAVE_POLICIES.get(lt, {})
        bal = conn.execute(
            "SELECT remaining_days FROM leave_balances WHERE user_id=? AND leave_type=?",
            (req.get("user_id"), lt),
        ).fetchone()
        remaining = float(bal["remaining_days"]) if bal else 0.0

        advance_required = policy.get("advance")
        advance_actual = None
        if advance_required is not None:
            try:
                submitted = dt.datetime.fromisoformat((req.get("submitted_at") or "").replace("T", " "))
                advance_actual = legacy.advance_workdays(conn, submitted, req.get("start_time") or "")
            except Exception:
                advance_actual = None

        employee = dict(conn.execute(
            "SELECT name,username,gender,age,unit_years,continuous_years,department FROM users WHERE id=?",
            (req.get("user_id"),),
        ).fetchone() or {})

        report = _build_review(
            lt=lt,
            req=req,
            policy=policy,
            remaining=remaining,
            advance_required=advance_required,
            advance_actual=advance_actual,
            employee=employee,
            conn=conn,
        )
        report.update({
            "request_id": request_id,
            "request_no": req.get("request_no"),
            "request_days": float(req.get("days") or 0),
            "remaining_balance": remaining,
            "advance_required": advance_required,
            "advance_actual": advance_actual,
            "applicant": {
                "name": employee.get("name"),
                "username": employee.get("username"),
                "department": employee.get("department") or "综合管理部",
                "gender": employee.get("gender") or "",
            },
        })
        return report
    finally:
        conn.close()


def review_batch(user):
    """批量预审当前待办，按风险从高到低排序。"""
    if not user or user.get("role") != "approver":
        return {"error": "仅审批员可批量预审"}
    import server as legacy
    conn = legacy.db()
    try:
        scope = legacy.approval_scope_user_ids(conn, user["id"])
        if not scope:
            rows = []
        else:
            marks = ",".join("?" * len(scope))
            rows = conn.execute(
                "SELECT id FROM leave_requests WHERE status IN ('pending','reported','supplement_required') "
                "AND user_id IN (%s) "
                "ORDER BY CASE WHEN deadline_at IS NULL THEN 1 ELSE 0 END, deadline_at ASC, submitted_at ASC LIMIT 30" % marks,
                tuple(scope),
            ).fetchall()
    finally:
        conn.close()

    items = []
    for row in rows:
        report = review_request(row["id"], user)
        if report and "error" not in report:
            items.append(report)
    items.sort(key=lambda x: (x.get("score", 100), -x.get("high_risk_count", 0)))

    from collections import Counter
    verdicts = Counter(x.get("verdict", "需关注") for x in items)
    summary = "待办 %d 笔：通过 %d，需关注 %d，不通过 %d" % (
        len(items), verdicts.get("通过", 0), verdicts.get("需关注", 0), verdicts.get("不通过", 0),
    )
    return {"count": len(items), "summary": summary, "items": items}
