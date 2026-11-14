package com.demo.order.service;

import com.demo.order.entity.OrderEntity;
import com.demo.order.repo.JpaOrderRepository;
import org.springframework.beans.factory.annotation.Autowired;

public class JpaOrderService {
    @Autowired
    private JpaOrderRepository jpaOrderRepository;

    public OrderEntity load(String id) {
        return jpaOrderRepository.findById(id).orElse(null);
    }
}
