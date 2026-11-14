package com.acme.inv.controller;

import com.acme.inv.api.InventoryApi;
import com.acme.inv.service.InventoryService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class InventoryController implements InventoryApi {
    @Autowired
    private InventoryService inventoryService;

    @Override
    public String deduct(String body) {
        return inventoryService.deductStock(body);
    }
}
