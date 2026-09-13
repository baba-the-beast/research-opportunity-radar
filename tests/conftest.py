import urllib.parse
from urllib.robotparser import RobotFileParser

import pytest

from radar.sources.agency_scraper_base import reset_robots_cache

MOCK_ROBOTS_BY_HOST = {
    "https://www.nsf.gov": [
        "User-agent: *",
        "Allow: /core/*.css$",
        "Allow: /core/*.css?",
        "Allow: /core/*.js$",
        "Allow: /core/*.js?",
        "Allow: /core/*.gif",
        "Allow: /core/*.jpg",
        "Allow: /core/*.jpeg",
        "Allow: /core/*.png",
        "Allow: /core/*.svg",
        "Allow: /profiles/*.css$",
        "Allow: /profiles/*.css?",
        "Allow: /profiles/*.js$",
        "Allow: /profiles/*.js?",
        "Allow: /profiles/*.gif",
        "Allow: /profiles/*.jpg",
        "Allow: /profiles/*.jpeg",
        "Allow: /profiles/*.png",
        "Allow: /profiles/*.svg",
        "Disallow: /core/",
        "Disallow: /profiles/",
        "Disallow: /README.md",
        "Disallow: /composer/Metapackage/README.txt",
        "Disallow: /composer/Plugin/ProjectMessage/README.md",
        "Disallow: /composer/Plugin/Scaffold/README.md",
        "Disallow: /composer/Plugin/VendorHardening/README.txt",
        "Disallow: /composer/Template/README.txt",
        "Disallow: /modules/README.txt",
        "Disallow: /sites/README.txt",
        "Disallow: /themes/README.txt",
        "Disallow: /web.config",
        "Disallow: /admin/",
        "Disallow: /comment/reply/",
        "Disallow: /filter/tips",
        "Disallow: /node/add/",
        "Disallow: /search/",
        "Disallow: /media/oembed",
        "Disallow: /*/media/oembed",
        "Disallow: /index.php/admin/",
        "Disallow: /index.php/comment/reply/",
        "Disallow: /index.php/filter/tips",
        "Disallow: /index.php/node/add/",
        "Disallow: /index.php/search/",
        "Disallow: /index.php/media/oembed",
        "Disallow: /index.php/*/media/oembed",
        "Disallow: /careers/openings",
        "Disallow: /careers/openings?*",
        "Disallow: /events?*",
        "Disallow: /events/past",
        "Disallow: /events/past?*",
        "Disallow: /news/releases",
        "Disallow: /news/releases?*",
        "Disallow: /funding/initiatives/reu/search",
        "Disallow: /funding/initiatives/reu/search?*",
        "Disallow: /honorary-awards/national-medal-science/recipients?*",
        "Disallow: /honorary-awards/pecase/recipients?*",
        "Disallow: /funding/opportunities?*",
        "Disallow: /funding/opps",
        "Disallow: /funding/opps?*",
        "Disallow: /funding/opportunities/csvexport",
        "Disallow: /funding/opportunities/csvexport?*",
        "Disallow: /funding/opps/csvexport",
        "Disallow: /funding/opps/csvexport?*",
        "Disallow: /form/*",
        "Disallow: /staff",
        "Disallow: /staff?*",
        "Disallow: /staff/org",
        "Disallow: /staff/org?*",
        "Disallow: /cgi-bin/",
        "Disallow: /awardsearch/*",
        "Disallow: /por/*",
        "Disallow: /pubs/*",
        "Sitemap: https://www.nsf.gov/sitemap.xml",
        "Sitemap: https://www.nsf.gov/sitemap-s3.xml",
    ],
    "http://www.wikicfp.com": [
        "User-agent: *",
        "Disallow:",
        "Crawl-delay: 5",
    ],
    "https://dst.gov.in": [
        "User-agent: *",
        "Disallow:",
    ],
    "https://main.icmr.nic.in": [
        "User-agent: *",
        "Allow: /",
    ],
    "https://icmr.gov.in": [
        "User-agent: *",
        "Allow: /",
    ],
    "https://www.icmr.gov.in": [
        "User-agent: *",
        "Allow: /",
    ],
    "https://dbtindia.gov.in": [
        "User-agent: *",
        "Disallow:",
    ],
    "https://dbt.gov.in": [
        "User-agent: *",
        "Disallow:",
    ],
}


@pytest.fixture(autouse=True)
def setup_test_env(monkeypatch):
    monkeypatch.setenv("ALLOW_IN_MEMORY_DB", "1")
    monkeypatch.setenv("OPENALEX_API_KEY", "test_key_for_ci")
    from radar import config
    monkeypatch.setattr(config, "ALLOW_IN_MEMORY_DB", True)
    monkeypatch.setattr(config, "OPENALEX_API_KEY", "test_key_for_ci")


@pytest.fixture(autouse=True)
def hermetic_robots_mock(monkeypatch):
    """
    Enforces hermetic tests by preventing unmocked live network requests to /robots.txt.
    Intercepts urllib.robotparser.RobotFileParser.read to parse known mock rules in-memory.
    """
    reset_robots_cache()

    def mocked_read(self):
        url = getattr(self, "url", "")
        if url:
            parsed = urllib.parse.urlparse(url)
            base = f"{parsed.scheme}://{parsed.netloc}"
            if base in MOCK_ROBOTS_BY_HOST:
                self.parse(MOCK_ROBOTS_BY_HOST[base])
                return

        # Default fail-open in-memory parsing without network access
        self.parse(["User-agent: *", "Disallow:"])

    monkeypatch.setattr(RobotFileParser, "read", mocked_read)
    yield
    reset_robots_cache()
