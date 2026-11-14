import { submitOrder } from '../../api/order';

export function onSubmit() {
  submitOrder({ sku: 'a' });
}