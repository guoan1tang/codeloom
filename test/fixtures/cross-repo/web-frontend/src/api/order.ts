export const OrderApi = {
  create: (payload: unknown) => fetch('/api-order/orders', { method: 'POST', body: JSON.stringify(payload) }),
};
