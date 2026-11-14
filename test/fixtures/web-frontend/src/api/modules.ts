import { http } from './http';

export const OrderApi = {
  list: () => http.get('/orders/list'),
  create: () => http.get('/orders/create'),
};
