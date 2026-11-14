package com.acme.events.job;

import org.springframework.scheduling.annotation.Scheduled;

public class DailySettleJob {
    @Scheduled(cron = "0 0 2 * * ?")
    public void settle() {
    }
}
