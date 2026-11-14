import { submitOrder } from './order';

it('submits order', () => {
  submitOrder({ sku: 'a' });
});