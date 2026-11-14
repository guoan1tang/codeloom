package com.acme.multi.order.controller;

import com.acme.multi.order.api.OrderApi;
import com.acme.multi.order.service.OrderService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController implements OrderApi {
    @Autowired
    private OrderService orderService;

    @Override
    public String create(String body) {
        return orderService.createOrder(body);
    }
}
