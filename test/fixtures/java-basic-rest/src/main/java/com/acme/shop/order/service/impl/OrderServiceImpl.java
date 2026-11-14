package com.acme.shop.order.service.impl;

import com.acme.shop.order.repo.OrderRepository;
import com.acme.shop.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class OrderServiceImpl implements OrderService {
    @Autowired
    private OrderRepository orderRepository;

    /** 创建订单并落库 */
    public String createOrder(String body) {
        orderRepository.save(body);
        return body;
    }

    public String findById(String id) {
        return orderRepository.findById(id);
    }

    public void cancel(String id) {
        orderRepository.delete(id);
    }

    public String search(String keyword) {
        return orderRepository.findByKeyword(keyword);
    }
}
