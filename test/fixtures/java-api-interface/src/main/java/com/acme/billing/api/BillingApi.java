package com.acme.billing.api;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;

@FeignClient(name = "billing-service", path = "/billing")
public interface BillingApi {

    @PostMapping("/charge")
    String charge(String body);

    @GetMapping("/{id}")
    String query(String id);
}
