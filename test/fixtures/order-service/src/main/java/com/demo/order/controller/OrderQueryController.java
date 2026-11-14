package com.demo.order.controller;

import com.demo.order.api.OrderApi;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderQueryController implements OrderApi {

    @Override
    public String query(String request) {
        return "ok";
    }

    @Override
    public String stats() {
        return "stats";
    }
}