package com.acme.orm.service;

import com.acme.orm.entity.ProductEntity;
import com.acme.orm.mapper.ProductMapper;
import com.acme.orm.mapper.ProductXmlMapper;
import com.acme.orm.repo.JpaProductRepository;
import org.springframework.beans.factory.annotation.Autowired;

public class ProductService {
    @Autowired
    private ProductMapper productMapper;
    @Autowired
    private ProductXmlMapper xmlMapper;
    @Autowired
    private JpaProductRepository jpaRepository;

    public Object find(String id) { return productMapper.selectById(id); }
    public void save(ProductEntity entity) { productMapper.insert(entity); }
    public String byXml(String id) { return xmlMapper.selectById(id); }
    public void touchXml(String id) { xmlMapper.touch(id); }
    public String list() { return xmlMapper.list(); }
    public long audit(Integer status) { return jpaRepository.countAudit(status); }
}
