package com.acme.billing.controller;

import com.acme.billing.api.BillingApi;
import com.acme.billing.service.BillingService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class BillingController implements BillingApi {
    @Autowired
    private BillingService billingService;

    @Override
    public String charge(String body) {
        return billingService.charge(body);
    }

    @Override
    public String query(String id) {
        return billingService.query(id);
    }
}
