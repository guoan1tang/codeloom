package com.acme.events.job;

import com.xxl.job.core.handler.annotation.XxlJob;

public class StockSyncJob {
    @XxlJob("stock-sync")
    public void run(String param) {
    }
}
