package com.demo.order.mq;

import com.xxl.job.core.handler.annotation.XxlJob;

public class StockSyncJob {

    @XxlJob("stockSyncJob")
    public void execute(String param) {
        // sync stock
    }
}