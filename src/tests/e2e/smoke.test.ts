import { By, VSBrowser, WebDriver, until } from 'vscode-extension-tester';
import path from 'path';
import { ActivityBar, ViewControl } from 'vscode-extension-tester';

describe('basic suite', () => {
  let browser: VSBrowser;
  let driver: WebDriver;
  
  before(async () => {
    browser = VSBrowser.instance;
    driver = browser.driver;
  });
  
  it('smoke test', async () => {
    await VSBrowser.instance.openResources(path.join('samples', 'basic'));
    let control: ViewControl | undefined = undefined;
    
    // Testing view is only available after the extension is activated which can take several seconds
    await driver.wait(async () => {
      control = await new ActivityBar().getViewControl('Testing');
      return control !== undefined;
    }, 10000); 

    await control!.openView();

    await driver.wait(until.elementLocated(By.xpath("//*[contains(text(), 'test/add.test.ts')]")), 10000);
  });
});