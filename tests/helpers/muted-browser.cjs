const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const launch=chromium.launch.bind(chromium);
chromium.launch=async options=>{
  const browser=await launch({...options,args:[...(options?.args || []),'--mute-audio']});
  const newContext=browser.newContext.bind(browser);
  browser.newContext=async options=>{
    const context=await newContext(options);
    await context.route('**/api/client-diagnostic',route=>route.fulfill({status:202,json:{ok:true}}));
    return context;
  };
  return browser;
};
