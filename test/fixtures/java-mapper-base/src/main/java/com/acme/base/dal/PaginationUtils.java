package com.acme.base.dal;

/** 通用分页工具：查询发生在工具类内部，表边需要回传给调用方 */
public class PaginationUtils {
    public static Object queryAll(UserMapper registry) {
        return registry.selectById(1L);
    }
}
