package com.acme.conf.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PostMapping;

@FeignClient(name = "inventory-service", path = "/bff/inventory")
public interface InventoryFeign {
    @PostMapping("/ping")
    String ping();
}
