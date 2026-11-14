package com.demo.inventory;

import org.junit.jupiter.api.Test;

public class InventoryServiceImplTest {
    @Test
    public void testDeductStock() {
        InventoryServiceImpl svc = new InventoryServiceImpl();
        svc.deductStock("sku-1", 2);
    }
}