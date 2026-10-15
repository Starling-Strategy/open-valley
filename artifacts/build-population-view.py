"""Run: uv run --no-project --with xlrd --with openpyxl python artifacts/build-population-view.py"""
import csv
import hashlib
import json
from pathlib import Path
import openpyxl
import xlrd

ROOT = Path(__file__).parent
towns = ['Duxbury', 'Fayston', 'Moretown', 'Waitsfield', 'Warren', 'Waterbury']
sheet = xlrd.open_workbook(ROOT / 'vermont-town-population-1930-2025.xls').sheet_by_index(0)
town_rows = {str(sheet.cell_value(i, 1)).title(): i for i in range(8, sheet.nrows)}
population = []
for col in range(36, 62):
    year = int(str(sheet.cell_value(7, col)).replace('^', '').split('.')[0])
    counts = {town: int(sheet.cell_value(town_rows[town], col)) for town in towns}
    population.append(dict(year=year, value=sum(counts.values()), towns=counts,
                           kind='Census' if year in [2000, 2010, 2020] else 'Estimate'))
assert len(population) == 26 and population[0]['value'] == 12338
book = openpyxl.load_workbook(ROOT / 'aoe-enrollment-20251125.xlsx', read_only=True, data_only=True)
rows = book.active.iter_rows(values_only=True)
header = next(rows)
ids = {'PS107', 'PS138', 'PS193', 'PS315', 'PS320', 'PS390', 'PS391', 'PS393'}
groups = {}
for row_number, row in enumerate(rows, 2):
    row = dict(zip(header, row))
    sid, year = row['SchoolIdentifier'], row['SchoolYear']
    if sid not in ids or row['DataCollectionName'] != 'DC#06_FALL_ADM_Official':
        continue
    # K full-time + K part-time + grades 1–12. Neither PK nor adults.
    grades = tuple(row[k] for k in header[6:20])
    assert all(isinstance(v, (int, float)) and v >= 0 for v in grades), (year, sid)
    key = (year, sid)
    if key in groups:
        assert groups[key]['grades'] == grades, ('Conflicting duplicate', key)
        groups[key]['rows'].append(row_number)
    else:
        groups[key] = dict(grades=grades, rows=[row_number], name=row['OrganizationName'])
enrollment = []
for year in sorted({key[0] for key in groups}):
    schools = {sid: v for (y, sid), v in groups.items() if y == year}
    assert set(schools) == (ids if year <= 2019 else ids - {'PS393'})
    if 'PS393' in schools:
        # Separate historical middle/high records must not overlap grade bands.
        assert sum(schools['PS138']['grades'][:10]) == 0
        assert sum(schools['PS393']['grades'][10:]) == 0
    enrollment.append(dict(year=year - 1, school_year=f'{year-1}–{str(year)[-2:]}',
                           value=int(sum(sum(v['grades']) for v in schools.values())),
                           schools=schools, plot=year != 2018))
with open('data/school-board/public/enrollment.csv') as f:
    attending = [dict(year=int(r['school_year'][:4]), value=int(r['value']))
                 for r in csv.DictReader(f)
                 if r['series_id'] == 'attending-october' and r['entity_id'] == 'huusd'
                 and r['value_state'] == 'observed']
assert len(attending) == 5, attending
sources = [
    dict(id='VDH', url='https://www.healthvermont.gov/sites/default/files/document/HSI-STAT-Population-of-Vermont-Towns-1930-2025.xls', file='vermont-town-population-1930-2025.xls'),
    dict(id='AOE', url='https://education.vermont.gov/sites/aoe/files/documents/edu-ved-enrollment-dataset-20251125.xlsx', file='aoe-enrollment-20251125.xlsx')]
for source in sources:
    source['sha256'] = hashlib.sha256((ROOT / source['file']).read_bytes()).hexdigest()
data = dict(population=population, enrollment=enrollment, attending=attending, sources=sources,
            retrieved='2026-10-14', notes=[
                'Fixed six-town geography, not a historical legal district boundary.',
                'AOE SchoolYear mapped to ending year; fall 2003 is school year 2003–04 (label 2004).',
                'Duplicate school/year grade vectors verified identical and counted once; workbook row locators retained.',
                'PS393 historical Harwood Middle counted separately through SY2019; later middle/high combined under PS138.',
                'AOE 2017–18 anomalous total retained for audit but omitted from chart pending reconciliation.',
                'AOE and district attending are separate definitions, not a spliced series.',
                'VDH 2011–19 intercensal estimates revised November 2024; census April 1, estimates July 1.',
                'Enrollment is not resident school-age population; no participation rate inferred.'])
(ROOT / 'population-enrollment-data.json').write_text(json.dumps(data, indent=2) + '\n')
html = (ROOT / 'enrollment-explorer.html').read_text()
start, end = '<!-- POPULATION START -->', '<!-- POPULATION END -->'
if start in html:
    html = html[:html.index(start)] + html[html.index(end) + len(end):]
template = (ROOT / 'population-view.html').read_text().replace('__DATA__', json.dumps(data))
card_start = html.index('<div class="cards">')
card_end = html.index('<nav aria-label="Explorer views">')
recent_cards = html[card_start:card_end]
html = html[:card_start] + html[card_end:]
html = html.replace('<nav aria-label="Explorer views">', start + template + end + '<nav aria-label="Explorer views">')
html = html.replace('<nav aria-label="Explorer views">', recent_cards + '<nav aria-label="Explorer views">')
html = html.replace('<h1>Following the students.</h1>', '<h1>More residents.<br>Fewer students.</h1>')
html = html.replace('September 2026 figures are preliminary', 'Population through 2025 · September 2026 enrollment below is preliminary')
html = html.replace('Smaller incoming classes. Cohorts that change as they advance. Different patterns at different schools. Explore what HUUSD’s enrollment counts can—and cannot—tell us.', 'Twenty-five years in the six towns served by today’s HUUSD. Population has grown while school enrollment has declined. Explore the long view, then follow the classes and schools below.')
(ROOT / 'enrollment-explorer.html').write_text(html)
print('Built:', population[0]['value'], '→', population[-1]['value'], 'residents;', enrollment[0]['value'], '→', enrollment[-1]['value'], 'AOE K–12.')
