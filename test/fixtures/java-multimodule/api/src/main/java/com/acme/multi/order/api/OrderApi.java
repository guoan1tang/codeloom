package com.acme.multi.order.api;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;

@FeignClient(name = "order-service", path = "/api/order")
public interface OrderApi {
    @PostMapping("/create")
    String create(String body);
}
