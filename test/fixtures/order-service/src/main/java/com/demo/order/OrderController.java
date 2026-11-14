package com.demo.order;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
public class OrderController {
    @Autowired
    private OrderService orderService;

    @PostMapping("/orders")
    public String create(@RequestBody String body) {
        orderService.createOrder(body);
        return "ok";
    }
}