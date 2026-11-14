package com.demo.order.cache;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.data.redis.core.StringRedisTemplate;

public class OrderCache {
    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    public String get(String id) {
        return stringRedisTemplate.opsForValue().get("order:cache");
    }

    @Cacheable(value = "orderDetailCache")
    public String getCached(String id) {
        return id;
    }

    @CacheEvict(value = "orderDetailCache", allEntries = true)
    public void evict() {
    }
}
