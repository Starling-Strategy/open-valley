"""Check current Markdown links and the repository's canonical document contracts."""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ('AGENTS.md', 'STARTUP.md', 'docs/DEPLOYMENT.md')


def check(paths):
    errors = []
    checked = 0
    for name in paths:
        path = ROOT / name
        if path.suffix.lower() != '.md' or not path.is_file():
            continue
        checked += 1
        text = path.read_text()
        prose = re.sub(r'^```[^\n]*\n.*?^```\s*$', '', text, flags=re.M | re.S)
        for target in re.findall(r'\[[^\]\n]*\]\(([^)\n]+)\)', prose):
            target = target.split(' "', 1)[0].strip('<> ')
            url = urlsplit(target)
            if not url.scheme and not url.netloc and url.path:
                linked = ROOT / unquote(url.path).lstrip('/') if url.path.startswith('/') else path.parent / unquote(url.path)
                if not linked.exists():
                    errors.append(f'{name}: missing link target {target}')
        if name in CANONICAL:
            for field in ('Purpose', 'Audience', 'Status', 'Owner', 'Last updated'):
                if not re.search(r'^' + re.escape(field) + r':\s+\S', text, re.M):
                    errors.append(f'{name}: missing {field} contract field')
        if name.startswith('docs/plans/'):
            frontmatter = re.match(r'^---\n(.*?)\n---', text, re.S)
            if not frontmatter:
                errors.append(f'{name}: missing plan frontmatter')
            else:
                for field in ('title', 'type', 'date'):
                    if not re.search(r'^' + field + r':\s+\S', frontmatter[1], re.M):
                        errors.append(f'{name}: missing plan {field}')
    return checked, errors


if __name__ == '__main__':
    args = sys.argv[1:]
    if len(args) == 2 and args[0] == '--base':
        args = subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=ACMR', args[1] + '...HEAD'], cwd=ROOT, text=True).splitlines()
    count, errors = check(args or ['README.md', 'STARTUP.md', 'CLAUDE.md', 'docs/DEPLOYMENT.md', 'docs/school-board/README.md', 'scripts/school_board/README.md'])
    for error in errors:
        print(error, file=sys.stderr)
    print(f'Checked {count} Markdown files; {len(errors)} errors.')
    sys.exit(bool(errors))
