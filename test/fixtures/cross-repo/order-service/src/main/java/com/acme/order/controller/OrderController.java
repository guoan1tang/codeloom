package com.acme.order.controller;

import com.acme.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
    @Autowired
    private OrderService orderService;

    @PostMapping("/orders")
    public String create(String body) {
        return orderService.createOrder(body);
    }
}
