package com.acme.billing.service;

import org.springframework.stereotype.Service;

@Service
public class BillingService {
    public String charge(String body) { return body; }
    public String query(String id) { return id; }
}
