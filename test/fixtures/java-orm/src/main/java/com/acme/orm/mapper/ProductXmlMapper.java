package com.acme.orm.mapper;

import org.apache.ibatis.annotations.Select;

public interface ProductXmlMapper {
    String selectById(String id);
    void touch(String id);

    @Select("select * from t_product where status = 1")
    String list();
}
