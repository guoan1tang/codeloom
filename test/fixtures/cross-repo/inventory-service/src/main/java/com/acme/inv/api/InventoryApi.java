package com.acme.inv.api;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;

@FeignClient(name = "inventory-service", path = "/inventory")
public interface InventoryApi {
    @PostMapping("/deduct")
    String deduct(String body);
}
