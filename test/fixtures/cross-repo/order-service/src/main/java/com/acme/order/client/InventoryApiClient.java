package com.acme.order.client;

import com.acme.inv.api.InventoryApi;
import org.springframework.beans.factory.annotation.Autowired;

public class InventoryApiClient {
    @Autowired
    private InventoryApi inventoryApi;

    public String callDeduct(String body) {
        return inventoryApi.deduct(body);
    }
}
