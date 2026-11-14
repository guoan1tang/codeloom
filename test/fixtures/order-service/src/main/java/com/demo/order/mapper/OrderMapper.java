package com.demo.order.mapper;

import org.apache.ibatis.annotations.Select;

public interface OrderMapper {
    String selectById(String id);

    void touch(String id);

    @Select("select count(1) from t_order_audit where status = #{status}")
    int countAudit(String status);
}
