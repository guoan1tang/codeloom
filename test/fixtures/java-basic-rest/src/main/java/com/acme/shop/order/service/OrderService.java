package com.acme.shop.order.service;

public interface OrderService {
    String createOrder(String body);
    String findById(String id);
    void cancel(String id);
    String search(String keyword);
}
