# Open Valley web application

Next.js serves the public Homes and Schools experience. Start with the
[local development guide](../STARTUP.md); it owns installation, runtime inputs,
and verification commands. The [deployment runbook](../docs/DEPLOYMENT.md)
records the Icculus/Openship setup.

School data is read server-side from the active PostgreSQL publication. No
school source archive or snapshot belongs in this application's build context.
The root layout supplies the shared navigation and footer. Articles live in
`src/content/posts/`; see [article conventions](../CLAUDE.md#articles).
