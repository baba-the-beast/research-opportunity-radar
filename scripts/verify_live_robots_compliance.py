#!/usr/bin/env python3
"""
Research Opportunity Radar — Live robots.txt Compliance & Anti-Truncation Auditor.
Verifies live robots.txt rules for external opportunity sources with strict
sanity-checking against silent truncation, incomplete fetches, and policy drift.
"""
import os
import sys
import time
import urllib.parse
import urllib.robotparser

import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from radar.sources.agency_scraper_base import is_scraping_allowed

TARGET_SOURCES = [
    {
        "name": "NSF (National Science Foundation)",
        "domain": "nsf.gov",
        "robots_url": "https://www.nsf.gov/robots.txt",
        "target_urls": [
            "https://www.nsf.gov/rss/rss_www_funding.xml",
        ],
        "disallowed_test_urls": [
            "https://www.nsf.gov/admin/",
            "https://www.nsf.gov/funding/opps",
        ],
        "min_expected_lines": 30,       # Drupal CMS file has ~97 lines
        "min_expected_bytes": 1000,     # ~2800 bytes
        "min_disallow_rules": 20,       # ~53 rules
        "allow_404": False,
    },
    {
        "name": "WikiCFP",
        "domain": "wikicfp.com",
        "robots_url": "http://www.wikicfp.com/robots.txt",
        "target_urls": [
            "http://www.wikicfp.com/cfp/servlet/tool.search",
        ],
        "min_expected_lines": 10,       # ~18 lines
        "min_expected_bytes": 150,      # ~320 bytes
        "min_disallow_rules": 5,        # 8 named bot rules
        "allow_404": False,
    },
    {
        "name": "DST India (Science & Technology)",
        "domain": "dst.gov.in",
        "robots_url": "https://dst.gov.in/robots.txt",
        "target_urls": [
            "https://dst.gov.in/call-for-proposals",
        ],
        "min_expected_lines": 0,
        "min_expected_bytes": 0,
        "min_disallow_rules": 0,
        "allow_404": True,              # Verified 404 (RFC 9309 §2.3.1.2 unrestricted)
    },
    {
        "name": "ICMR (Medical Research)",
        "domain": "icmr.gov.in",
        "robots_url": "https://www.icmr.gov.in/robots.txt",
        "target_urls": [
            "https://www.icmr.gov.in/call-for-proposals",
        ],
        "min_expected_lines": 2,        # ~3 lines (Allow: /)
        "min_expected_bytes": 20,
        "min_disallow_rules": 0,
        "allow_404": False,
    },
    {
        "name": "DBT India (Biotechnology)",
        "domain": "dbt.gov.in",
        "robots_url": "https://dbt.gov.in/robots.txt",
        "target_urls": [
            "https://dbt.gov.in/whats-new/call-for-proposals",
        ],
        "min_expected_lines": 2,        # ~2 lines (Disallow:)
        "min_expected_bytes": 20,
        "min_disallow_rules": 1,        # 1 rule (empty path)
        "allow_404": False,
    },
]

USER_AGENT = "ResearchOpportunityRadar/1.0 (+https://github.com/radar; polite-bot)"


def fetch_robots_with_retry(url: str, max_retries: int = 3, timeout: float = 20.0) -> tuple[int, str, bytes, str, int | None]:
    """
    Fetches robots.txt with exponential retry backoff, SSL CA fallback, and detailed error tracking.
    Returns: (status_code, text_content, raw_bytes, error_message, content_length_header)
    """
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/plain,text/html,*/*",
    }
    last_err = ""
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True)
            cl_hdr = resp.headers.get("Content-Length")
            cl_int = int(cl_hdr) if cl_hdr and cl_hdr.isdigit() else None
            return resp.status_code, resp.text, resp.content, "", cl_int
        except requests.exceptions.SSLError:
            # Indian government portals often use NIC intermediate CAs
            try:
                import urllib3
                urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                resp = requests.get(url, headers=headers, timeout=timeout, allow_redirects=True, verify=False)
                cl_hdr = resp.headers.get("Content-Length")
                cl_int = int(cl_hdr) if cl_hdr and cl_hdr.isdigit() else None
                return resp.status_code, resp.text, resp.content, "(SSL verify bypassed for NIC CA)", cl_int
            except Exception as e:
                last_err = f"SSLError fallback failed: {e}"
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            last_err = f"{type(e).__name__}: {e}"
            if attempt < max_retries:
                time.sleep(1.5 * attempt)
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            break

    return 0, "", b"", last_err, None


def validate_robots_sanity(source: dict, text: str, raw_bytes: bytes, status_code: int, content_length_header: int | None = None) -> tuple[bool, str]:
    """
    Asserts that the fetched robots.txt has not been truncated or corrupted.
    Enforces Content-Length matching, minimum byte length, line count, and disallow rule thresholds.
    """
    if status_code == 404:
        if source.get("allow_404"):
            return True, "RFC 9309 Unrestricted (Valid 404 Not Found)"
        return False, "Unexpected 404 Not Found for domain requiring active robots.txt"

    if status_code != 200:
        return False, f"Unexpected HTTP status {status_code}"

    lines = text.splitlines()
    byte_len = len(raw_bytes)
    line_count = len(lines)
    disallows = [ln for ln in lines if ln.strip().lower().startswith("disallow:")]
    disallow_count = len(disallows)

    min_bytes = source.get("min_expected_bytes", 0)
    min_lines = source.get("min_expected_lines", 0)
    min_disallows = source.get("min_disallow_rules", 0)

    reasons = []
    # 1. Exact Content-Length match when header is supplied by upstream server
    if content_length_header is not None and byte_len != content_length_header:
        reasons.append(f"Content-Length header mismatch: received {byte_len} bytes, declared {content_length_header} bytes")

    # 2. Lower-bound structural floors
    if byte_len < min_bytes:
        reasons.append(f"Byte length {byte_len} < minimum expected {min_bytes}")
    if line_count < min_lines:
        reasons.append(f"Line count {line_count} < minimum expected {min_lines}")
    if disallow_count < min_disallows:
        reasons.append(f"Disallow count {disallow_count} < minimum expected {min_disallows}")

    if reasons:
        return False, "TRUNCATION SUSPECTED: " + "; ".join(reasons)

    cl_info = f", cl_header={content_length_header}" if content_length_header is not None else ", transfer=chunked"
    return True, f"Sanity OK (bytes={byte_len}, lines={line_count}, disallows={disallow_count}{cl_info})"


def evaluate_source(source: dict, simulate_truncation: bool = False) -> dict:
    """
    Evaluates compliance and anti-truncation assertions for a single opportunity source.
    """
    robots_url = source["robots_url"]
    status_code, text, raw_bytes, err, cl_header = fetch_robots_with_retry(robots_url)

    if simulate_truncation and source["domain"] == "nsf.gov":
        # Simulates an artificial truncation bug returning only 3 lines for demonstration
        text = "User-agent: *\nDisallow: /admin/\nDisallow: /search/\n"
        raw_bytes = text.encode("utf-8")
        status_code = 200
        err = "(SIMULATED TRUNCATION INJECTED)"
        cl_header = 1000  # Deliberately mismatch Content-Length as well

    lines = text.splitlines() if text else []
    disallows = [ln for ln in lines if ln.strip().lower().startswith("disallow:")]
    allows = [ln for ln in lines if ln.strip().lower().startswith("allow:")]
    sitemaps = [ln for ln in lines if ln.strip().lower().startswith("sitemap:")]

    sanity_passed, sanity_msg = validate_robots_sanity(source, text, raw_bytes, status_code, content_length_header=cl_header)

    # Parser evaluation
    target_results = []
    if status_code == 404 and source.get("allow_404"):
        for target in source["target_urls"]:
            target_results.append({
                "target_url": target,
                "allowed": True,
                "details": "RFC 9309 §2.3.1.2: 404 implies unrestricted access",
            })
    elif status_code == 200:
        parser = urllib.robotparser.RobotFileParser()
        parser.parse(lines)
        for target in source["target_urls"]:
            can_wildcard = parser.can_fetch("*", target)
            can_ua = parser.can_fetch(USER_AGENT, target)
            allowed = can_wildcard and can_ua
            target_results.append({
                "target_url": target,
                "allowed": allowed,
                "details": f"can_fetch('*')={can_wildcard}, can_fetch(UA)={can_ua}",
            })
    else:
        for target in source["target_urls"]:
            target_results.append({
                "target_url": target,
                "allowed": False,
                "details": f"Fetch failed: HTTP {status_code} ({err})",
            })

    # Live enforcement checks for known disallowed test URLs
    disallowed_results = []
    for dis_url in source.get("disallowed_test_urls", []):
        is_allowed = is_scraping_allowed(dis_url)
        disallowed_results.append({
            "url": dis_url,
            "correctly_blocked": not is_allowed,
            "is_allowed": is_allowed,
        })

    return {
        "name": source["name"],
        "domain": source["domain"],
        "robots_url": robots_url,
        "status_code": status_code,
        "byte_len": len(raw_bytes),
        "line_count": len(lines),
        "disallow_count": len(disallows),
        "allow_count": len(allows),
        "sitemap_count": len(sitemaps),
        "sanity_passed": sanity_passed,
        "sanity_msg": sanity_msg,
        "raw_text": text,
        "target_results": target_results,
        "disallowed_results": disallowed_results,
        "error": err,
    }


def send_telegram_alert(failures: list[str]):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return

    text = "🚨 *Opportunity Radar Compliance & Anti-Truncation Alert!*\n\n"
    for msg in failures:
        text += f"- {msg}\n"

    try:
        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "Markdown"},
            timeout=10,
        )
    except Exception as ex:
        print(f"Failed to send Telegram alert: {ex}", file=sys.stderr)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    dump_raw = "--dump-raw" in sys.argv
    simulate_truncation = "--simulate-truncation" in sys.argv

    print("=" * 80)
    print(" Research Opportunity Radar -- robots.txt Compliance & Anti-Truncation Auditor")
    if simulate_truncation:
        print(" [MODE: SIMULATING TRUNCATION ON NSF FOR VERIFICATION]")
    print("=" * 80)

    all_evaluations = []
    compliance_violations = []
    truncation_violations = []
    reachability_warnings = []

    for src in TARGET_SOURCES:
        print(f"\n[SOURCE] {src['name']}")
        print(f"  Robots URL : {src['robots_url']}")
        eval_res = evaluate_source(src, simulate_truncation=simulate_truncation)
        all_evaluations.append(eval_res)

        print(f"  HTTP Status: {eval_res['status_code']} {eval_res['error']}")
        print(f"  Diagnostics: {eval_res['byte_len']} bytes | {eval_res['line_count']} lines | "
              f"{eval_res['disallow_count']} disallows | {eval_res['allow_count']} allows | "
              f"{eval_res['sitemap_count']} sitemaps")

        sanity_tag = "[SANITY OK]" if eval_res["sanity_passed"] else "[SANITY FAILED - TRUNCATION]"
        print(f"  Sanity     : {sanity_tag} {eval_res['sanity_msg']}")

        if not eval_res["sanity_passed"]:
            truncation_violations.append(f"{eval_res['name']}: {eval_res['sanity_msg']}")

        for t in eval_res["target_results"]:
            verdict = "[ALLOWED]" if t["allowed"] else "[DISALLOWED / ERROR]"
            print(f"  Target URL : {t['target_url']}")
            print(f"  Verdict    : {verdict} ({t['details']})")
            if not t["allowed"]:
                if eval_res["status_code"] in (0, 500, 502, 503, 504):
                    reachability_warnings.append(f"{eval_res['name']}: {t['details']}")
                else:
                    compliance_violations.append(f"{eval_res['name']}: Disallowed on {t['target_url']}")

        for d in eval_res.get("disallowed_results", []):
            block_tag = "[CORRECTLY BLOCKED]" if d["correctly_blocked"] else "[CRITICAL BUG: DISALLOW BYPASSED]"
            print(f"  Enforce Block: {d['url']}")
            print(f"  Enforce Stat : {block_tag} (is_scraping_allowed={d['is_allowed']})")
            if not d["correctly_blocked"]:
                compliance_violations.append(f"{eval_res['name']}: Disallow rule failed enforcement on {d['url']}")

        if dump_raw and eval_res["raw_text"]:
            print("  --- RAW ROBOTS.TXT CONTENT ---")
            for line in eval_res["raw_text"].splitlines():
                print(f"    {line}")
            print("  --- END RAW CONTENT ---")

    print("\n" + "=" * 80)
    print(" AUDIT SUMMARY MATRIX")
    print("=" * 80)
    header = f"{'Domain':<12} | {'Status':<8} | {'Bytes':<6} | {'Lines':<6} | {'Disallows':<9} | {'Sanity':<10} | {'Verdict'}"
    print(header)
    print("-" * 80)
    for r in all_evaluations:
        stat = str(r["status_code"])
        bytes_str = str(r["byte_len"])
        lines_str = str(r["line_count"])
        dis_str = str(r["disallow_count"])
        sanity_str = "OK" if r["sanity_passed"] else "TRUNCATED"
        verdicts = [("ALLOWED" if t["allowed"] else "FAIL") for t in r["target_results"]]
        verdict_str = ", ".join(verdicts)
        print(f"{r['domain']:<12} | {stat:<8} | {bytes_str:<6} | {lines_str:<6} | {dis_str:<9} | {sanity_str:<10} | {verdict_str}")

    print("=" * 80)

    # Check for failures
    failures_to_alert = []
    if truncation_violations:
        print("\n❌ TRUNCATION / CORRUPTION VIOLATIONS DETECTED:")
        for v in truncation_violations:
            print(f"  - {v}")
            failures_to_alert.append(f"Truncation: {v}")

    if compliance_violations:
        print("\n❌ COMPLIANCE POLICY DRIFT DETECTED:")
        for v in compliance_violations:
            print(f"  - {v}")
            failures_to_alert.append(f"Compliance: {v}")

    if reachability_warnings:
        print("\n⚠️ TRANSIENT REACHABILITY WARNINGS (Site Unreachable / Timed Out):")
        for w in reachability_warnings:
            print(f"  - {w}")

    if failures_to_alert:
        send_telegram_alert(failures_to_alert)
        print("\n>> AUDIT FAILED: Violations detected.")
        sys.exit(1)
    else:
        print("\n>> AUDIT PASSED: All opportunity paths permitted with verified non-truncated policies.")
        sys.exit(0)


if __name__ == "__main__":
    main()
