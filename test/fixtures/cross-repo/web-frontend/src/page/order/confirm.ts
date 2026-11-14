export function submitOrder(payload: unknown) {
  return fetch('/api-order/orders', { method: 'POST', body: JSON.stringify(payload) });
}
