package com.demo.order.client;

import com.demo.inventory.api.InventoryApi;
import org.springframework.beans.factory.annotation.Autowired;

public class InventoryApiClient {
    @Autowired
    private InventoryApi inventoryApi;

    public String callDeduct(String sku) {
        return inventoryApi.deduct(sku);
    }
}