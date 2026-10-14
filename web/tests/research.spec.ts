import { test, expect } from '@playwright/test';

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

test('answers show exact supporting wording and page references',async({page})=>{
  test.skip(!process.env.REBUILD_LIVE_PREVIEW,'Requires enabled preview composer');
  await page.route('**/api/ask',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({headline:'A planning guideline, not a bus schedule',mode:'generated',retrieval:{mode:'hybrid',reason:''},limitation:'Actual routes need further study.',paragraphs:[{heading:'Travel time',text:'The study sets a planning guideline for travel time.',citations:[{chunkId:'E1',quote:'Synthetic quoted planning guideline.'}]}],sources:[{id:'E1',documentId:'study',title:'Planning study',url:'https://huusd.org/board',libraryUrl:'/library/study#page-9',fileUrl:'/api/library/study/file/hash#page=9',page:9,date:'2025-03',kind:'Study',method:'pdf-text'}]})}));
  await page.goto('/ask');await page.getByLabel('Your question',{exact:true}).fill('What are the bus guidelines?');
  await page.getByRole('button',{name:'Ask Open Valley ↑'}).click();
  await expect(page.getByRole('heading',{name:'A planning guideline, not a bus schedule'})).toBeVisible();
  await page.getByText('Read the source wording',{exact:true}).click();
  await expect(page.locator('blockquote')).toHaveText('Synthetic quoted planning guideline.');
  await expect(page.getByRole('link',{name:'PDF page ↗'})).toHaveAttribute('href',/#page=9$/);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.research-story')).toHaveCount(0);
});
