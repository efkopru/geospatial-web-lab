import {test,expect} from '@playwright/test';

test('account changes and logout propagate to other tabs without retaining their drafts',async({context})=>{
 const first=await context.newPage();
 await first.goto('http://127.0.0.1:5174');
 await first.getByRole('button',{name:'Open workspace'}).click();
 await expect(first.locator('.identity strong')).toHaveText('Alex Morgan');
 await first.getByLabel('Scenario name').fill('Private staff draft');
 const second=await context.newPage();
 await second.goto('http://127.0.0.1:5174');
 await expect(second.locator('.identity strong')).toHaveText('Alex Morgan');
 await second.getByRole('button',{name:'Sign out'}).click();
 await expect(first.getByRole('button',{name:'Open workspace'})).toBeVisible({timeout:4000});
 await second.getByLabel('Email',{exact:true}).fill('reporter@example.test');
 await second.getByRole('button',{name:'Open workspace'}).click();
 await expect(second.locator('.identity strong')).toHaveText('Jordan Lee');
 await expect(first.locator('.identity strong')).toHaveText('Jordan Lee',{timeout:4000});
 await expect(first.getByLabel('Scenario name')).not.toHaveValue('Private staff draft');
 await expect(first.getByRole('button',{name:'Sign out'})).toBeVisible();
});
