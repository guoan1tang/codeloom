package com.demo.inventory;

public interface InventoryService {
    void deductStock(String skuId, Integer quantity);
}