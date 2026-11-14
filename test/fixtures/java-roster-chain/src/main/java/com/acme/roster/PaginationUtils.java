package com.acme.roster;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.IService;

import java.util.List;

/**
 * Generic pagination utility (mirrors customer-service PaginationUtils).
 * The concrete registry only arrives as an IService argument, so the utility
 * itself cannot know any table — edges must be attributed to the callers.
 */
public class PaginationUtils {
    public static <T> List<T> queryAllWithPagination(IService<T> service, LambdaQueryWrapper<T> queryWrapper) {
        long total = service.count(queryWrapper);
        return service.list(queryWrapper);
    }
}