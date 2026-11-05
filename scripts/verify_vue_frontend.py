"""Smoke-test the Vue frontend against a running local server."""

from __future__ import annotations

import argparse
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CHROME_CANDIDATES = (
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


def browser_executable() -> str | None:
    for path in CHROME_CANDIDATES:
        if path.is_file():
            return str(path)
    return None


def attach_error_capture(page: Page, errors: list[str]) -> None:
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on(
        "console",
        lambda message: errors.append(f"console.{message.type}: {message.text}")
        if message.type == "error" and "Failed to load resource" not in message.text
        else None,
    )
    page.on(
        "response",
        lambda response: errors.append(f"HTTP {response.status}: {response.url}")
        if response.status >= 400 and "favicon.ico" not in response.url
        else None,
    )


def login(page: Page, base_url: str, username: str) -> None:
    page.goto(base_url, wait_until="networkidle")
    page.fill('input[name="username"]', username)
    page.fill('input[name="password"]', "123456")
    page.locator("button.btn-primary.full").click()
    page.wait_for_function("location.hash && location.hash !== '#/login'", timeout=10_000)
    page.wait_for_load_state("networkidle")


def visit_routes(page: Page, base_url: str, routes: list[str]) -> None:
    for route in routes:
        page.goto(f"{base_url}/#{route}", wait_until="networkidle")
        page.wait_for_timeout(150)
        app_text = page.locator("#app").inner_text().strip()
        if not app_text:
            raise AssertionError(f"{route}: app root is empty")
        print(f"ok {route}: {app_text.splitlines()[0][:80]}")


def open_ai(page: Page) -> None:
    page.locator("button.ai-fab").click()
    page.locator(".ai-modal").wait_for(state="visible", timeout=5_000)
    page.wait_for_timeout(250)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()

    output_dir = ROOT / "outputs"
    output_dir.mkdir(exist_ok=True)
    errors: list[str] = []

    with sync_playwright() as playwright:
        launch_options = {"headless": not args.headed}
        executable = browser_executable()
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)

        employee = browser.new_page(viewport={"width": 1440, "height": 900})
        attach_error_capture(employee, errors)
        login(employee, args.base_url, "employee")
        visit_routes(
            employee,
            args.base_url,
            [
                "/home",
                "/apply",
                "/profile",
                "/records",
                "/guide",
                "/notifications",
            ],
        )
        employee.goto(f"{args.base_url}/#/home", wait_until="networkidle")
        open_ai(employee)
        employee.screenshot(path=str(output_dir / "vue-employee-home.png"), full_page=True)

        approver = browser.new_page(viewport={"width": 1440, "height": 900})
        attach_error_capture(approver, errors)
        login(approver, args.base_url, "approver")
        visit_routes(
            approver,
            args.base_url,
            [
                "/admin",
                "/history",
                "/adjustments",
                "/hr",
                "/delegation",
            ],
        )
        approver.goto(f"{args.base_url}/#/admin", wait_until="networkidle")
        open_ai(approver)
        approver.screenshot(path=str(output_dir / "vue-approver-admin.png"), full_page=True)

        mobile = browser.new_page(viewport={"width": 390, "height": 844})
        attach_error_capture(mobile, errors)
        login(mobile, args.base_url, "employee")
        mobile.goto(f"{args.base_url}/#/home", wait_until="networkidle")
        overflow = mobile.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth"
        )
        if overflow > 1:
            errors.append(f"mobile horizontal overflow: {overflow}px")
        mobile.screenshot(path=str(output_dir / "vue-employee-mobile.png"), full_page=True)

        browser.close()

    if errors:
        print("\nBrowser errors:")
        for error in errors:
            print(f"- {error}")
        return 1

    print("\nVue frontend smoke test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
