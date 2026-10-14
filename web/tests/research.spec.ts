import { test, expect } from '@playwright/test';
import { classroomBrief } from '../src/lib/research-classroom';
import { basicPlan } from '../src/lib/research-plan';

test('assistant and library accept the configured tunnel origin, not arbitrary origins',async({request})=>{
  test.skip(!process.env.REBUILD_LIVE_PREVIEW,'Requires configured private origins');
  for(const path of ['/api/ask','/api/library/search']) {
    const allowed=await request.post(path,{data:{},headers:{Origin:'http://127.0.0.1:13460',Host:'127.0.0.1:13460'}});
    expect(allowed.status()).toBe(400); // Passed origin validation; deliberately invalid body avoids inference.
    const denied=await request.post(path,{data:{},headers:{Origin:'https://example.org','X-Forwarded-Host':'example.org','X-Forwarded-Proto':'https'}});
    expect(denied.status()).toBe(403);
  }
});

test('library opens original PDF bytes, exact page links and alternative editions',async({page,request})=>{
  test.skip(!process.env.REBUILD_LIVE_PREVIEW,'Requires reviewed library');
  await page.goto('/library');
  await expect(page.getByRole('heading',{name:'Go straight to the source.'})).toBeVisible();
  await page.getByRole('button',{name:'Planning options',exact:true}).click();
  await expect(page.locator('.document-card')).toHaveCount(2);
  await page.getByRole('link',{name:'District reconfiguration options',exact:true}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('District reconfiguration options');
  await page.getByText('Compare another edition', {exact:true}).click();
  await expect(page.getByRole('link',{name:/Provided March draft/})).toBeVisible();
  const url=await page.getByRole('link',{name:'Read the PDF ↗',exact:true}).getAttribute('href');
  const file=await request.get(url!,{headers:{Range:'bytes=0-99'}});
  expect(file.status()).toBe(206);expect(file.headers()['cache-control']).toContain('no-store');
  expect((await file.body()).subarray(0,5).toString()).toBe('%PDF-');
  await page.goto('/library/18hZ4T-r5LPiTkvlm4YCXHOtcWd8QmJ-X#page-9');
  await expect(page.locator('#page-9')).toHaveAttribute('open','');
  await expect(page.locator('#page-9 a')).toHaveAttribute('href',/#page=9$/);
  await page.getByLabel('Find words in this document').fill('not-a-real-word-xyz');
  await expect(page.getByRole('status')).toHaveText('0 pages match');
});

test('citations open exact wording, preserve unchanged conversations and clear withdrawn evidence',async({page})=>{
  test.skip(!process.env.REBUILD_LIVE_PREVIEW,'Requires enabled preview composer');
  let version='fixture-one';
  await page.route('**/api/ask/evidence',route=>route.fulfill({json:{evidenceVersion:version}}));
  const requests:Record<string,unknown>[]=[];
  await page.route('**/api/ask',route=>{requests.push(route.request().postDataJSON());return route.fulfill({contentType:'application/json',body:JSON.stringify({headline:'A planning guideline, not a bus schedule',mode:'generated',evidenceVersion:'fixture-one',context:'synthetic-context',retrieval:{mode:'hybrid',reason:''},limitation:'Actual routes need further study.',paragraphs:[{heading:'Travel time',text:'The study sets a planning guideline for travel time.',citations:[{chunkId:'E1',quote:'Synthetic quoted planning guideline.'}]}],sources:[{id:'E1',documentId:'study',title:'Planning study',url:'https://huusd.org/board',libraryUrl:'/library/study#page-9',fileUrl:'/api/library/study/file/hash#page=9',page:9,date:'2025-03',kind:'Study',method:'pdf-text'}]})});});
  await page.goto('/ask');await page.getByLabel('Your question',{exact:true}).fill('What are the bus guidelines?');
  await page.getByRole('button',{name:'Ask Open Valley ↑'}).click();
  await expect(page.getByRole('heading',{name:'A planning guideline, not a bus schedule'})).toBeVisible();
  await page.getByRole('button',{name:'Read source wording: Planning study, page 9'}).click();
  await expect(page.locator('blockquote')).toHaveText('Synthetic quoted planning guideline.');
  await expect(page.getByRole('link',{name:'PDF page ↗'})).toHaveAttribute('href',/#page=9$/);
  await expect(page.getByRole('link',{name:'PDF page ↗'})).toHaveAttribute('target','_blank');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Rechecking the source collection…')).toHaveCount(0);
  await expect(page.locator('.research-story')).toHaveCount(1);
  await page.getByLabel('Ask a follow-up',{exact:true}).fill('What does that mean for Fayston?');
  await page.getByRole('button',{name:'Ask Open Valley ↑'}).click();
  await expect(page.locator('.research-story')).toHaveCount(2);
  expect(requests[1].context).toBe('synthetic-context');
  version='withdrawn';
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.research-story')).toHaveCount(0);
  await expect(page.locator('.availability[role="alert"]')).toContainText('evidence changed');
});

test('classroom guide stays readable on a narrow phone and offers a scoped follow-up',async({page})=>{
  test.skip(!process.env.REBUILD_LIVE_PREVIEW,'Requires enabled preview composer');
  await page.setViewportSize({width:320,height:740});
  const story=classroomBrief(basicPlan('Class sizes at all schools'),[]);
  await page.route('**/api/ask',route=>route.fulfill({json:{...story,mode:'reviewed',sources:[],retrieval:{mode:'reviewed',reason:''},evidenceVersion:'fixture'}}));
  await page.route('**/api/ask/evidence',route=>route.fulfill({json:{evidenceVersion:'fixture'}}));
  await page.goto('/ask');
  await page.getByRole('button',{name:/What are class sizes and adult-to-student ratios/}).click();
  await page.getByRole('button',{name:'Ask Open Valley ↑'}).click();
  await expect(page.getByRole('heading',{name:'Class size and adult coverage measure different things'})).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(page.getByText('Measurement guidance, not findings about classroom conditions.')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const bounds=await page.locator('.brief-table-scroll').boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(320);
  await page.getByRole('button',{name:/What is the latest published enrollment/}).click();
  await expect(page.getByLabel('Ask a follow-up',{exact:true})).toHaveValue('What is the latest published enrollment at each school?');
});
