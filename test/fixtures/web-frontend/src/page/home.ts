import { http } from '../api/http';

export function loadHome() {
  http.get('/home/data');
}
