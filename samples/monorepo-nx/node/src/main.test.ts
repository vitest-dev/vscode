import { library } from '@nx/library';
import { mainFunction } from './main';

describe('library from app', () => {
  it('should work', () => {
    expect(library()).toEqual('library');
  });
});

describe('main', () => {
  it('should work', () => {
    expect(mainFunction()).toEqual('hello world');
  });
});
