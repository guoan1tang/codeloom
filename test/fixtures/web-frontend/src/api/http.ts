import axios from 'axios';

export const http = {
  get(url: string) {
    return axios.request({ url, method: 'GET' });
  },
};
