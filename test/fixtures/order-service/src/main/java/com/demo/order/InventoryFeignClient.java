package com.demo.order;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;

@FeignClient(name = "inventory-service", path = "/inventory")
public interface InventoryFeignClient {
    @PostMapping("/deduct")
    String deduct(String sku);
}