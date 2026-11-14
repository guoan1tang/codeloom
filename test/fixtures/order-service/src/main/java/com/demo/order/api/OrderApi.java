package com.demo.order.api;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;

@FeignClient(name = "order-service")
public interface OrderApi {

    @PostMapping("/orders/query")
    String query(String request);

    @GetMapping("/orders/stats")
    String stats();
}