"""Proofs for the public-service deployment boundary."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_public_tree import scan_paths


ROOT = Path(__file__).resolve().parents[2]


class DeploymentGuardrailTests(unittest.TestCase):
    def test_next_configuration_rejects_a_direct_browser_api_variable(self):
        configuration = (ROOT / "web" / "next.config.ts").read_text(encoding="utf-8")

        self.assertIn('const publicApiVariable = "NEXT_PUBLIC_BASELINE_API_URL"', configuration)
        self.assertIn("INTERNAL_BASELINE_API_URL", configuration)
        self.assertIn('source: "/api/baseline/:path*"', configuration)

    def test_api_and_web_images_copy_only_their_public_runtime_inputs(self):
        api_dockerfile = (ROOT / "Dockerfile.api").read_text(encoding="utf-8")
        web_dockerfile = (ROOT / "Dockerfile.web").read_text(encoding="utf-8")

        self.assertNotRegex(api_dockerfile, r"(?m)^COPY \\. \\.$")
        self.assertIn("COPY src ./src", api_dockerfile)
        self.assertIn("COPY releases ./releases", api_dockerfile)
        self.assertNotIn("warren/outputs", api_dockerfile)
        self.assertNotIn("warren/outputs", web_dockerfile)

    def test_compose_keeps_the_api_internal_and_waits_for_its_health_check(self):
        compose = (ROOT / "docker-compose.coolify.yml").read_text(encoding="utf-8")

        self.assertIn("condition: service_healthy", compose)
        self.assertIn("INTERNAL_BASELINE_API_URL: http://api:8998", compose)
        self.assertNotIn("ports:", compose)
        self.assertNotIn("networks:", compose)

    def test_public_tree_guard_rejects_private_paths_and_fields_without_values(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            release = root / "releases" / "warren"
            release.mkdir(parents=True)
            release.joinpath("summary.json").write_text(
                '{"town":"Warren","nested":{"mailing_state":"CA"}}', encoding="utf-8"
            )

            diagnostics = scan_paths(
                root,
                ["warren/outputs/private.jsonl", "releases/warren/summary.json"],
            )

        self.assertEqual(
            diagnostics,
            [
                "releases/warren/summary.json: invalid public artifact",
                "releases/warren/summary.json: restricted field nested.mailing_state",
                "warren/outputs/private.jsonl: tracked private-data path",
            ],
        )
        self.assertNotIn("CA", "\n".join(diagnostics))

    def test_combined_release_image_copies_only_public_inputs_and_exposes_one_port(self):
        dockerfile = (ROOT / "Dockerfile.release").read_text(encoding="utf-8")

        self.assertNotRegex(dockerfile, r"(?m)^COPY \. \.$")
        self.assertIn("COPY src ./src", dockerfile)
        self.assertIn("COPY releases ./releases", dockerfile)
        self.assertNotIn("warren/outputs", dockerfile)
        self.assertIn("EXPOSE 3000", dockerfile)
        self.assertNotIn("EXPOSE 8998", dockerfile)

    def test_combined_release_keeps_the_api_on_loopback(self):
        supervisor = (ROOT / "ops" / "supervisord.conf").read_text(encoding="utf-8")

        self.assertIn("--host 127.0.0.1 --port 8998", supervisor)
        self.assertIn("next/dist/bin/next start -H 0.0.0.0 -p 3000", supervisor)

    def test_combined_release_health_check_uses_release_readiness(self):
        dockerfile = (ROOT / "Dockerfile.release").read_text(encoding="utf-8")
        configuration = (ROOT / "web" / "next.config.ts").read_text(encoding="utf-8")

        self.assertIn("http://127.0.0.1:3000/healthz", dockerfile)
        self.assertIn('source: "/healthz"', configuration)
        self.assertIn("${baselineApiUrl}/healthz", configuration)

    def test_kamal_config_uses_a_local_registry_and_private_proxy_ports(self):
        deploy = (ROOT / "config" / "deploy.yml").read_text(encoding="utf-8")

        self.assertIn("server: localhost:5555", deploy)
        self.assertIn("user: root", deploy)
        self.assertIn("app_port: 3000", deploy)
        self.assertIn("path: /healthz", deploy)
        self.assertIn("bind_ips:", deploy)
        self.assertIn("- 127.0.0.1", deploy)
        self.assertIn("http_port: 18081", deploy)
        self.assertIn("https_port: 18444", deploy)
        self.assertNotIn("http_port: 80", deploy)
        self.assertNotIn("https_port: 443", deploy)

    def test_compose_file_validates_when_docker_is_available(self):
        if not self._docker_compose_available():
            self.skipTest("Docker Compose is unavailable in this test environment")
        subprocess.run(
            ["docker", "compose", "-f", "docker-compose.coolify.yml", "config", "--quiet"],
            cwd=ROOT,
            check=True,
        )

    @staticmethod
    def _docker_compose_available() -> bool:
        return (
            subprocess.run(
                ["docker", "compose", "version"], capture_output=True, check=False
            ).returncode
            == 0
        )
