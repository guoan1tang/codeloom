package com.acme.conf.service;

import com.acme.conf.mapper.WidgetMapper;
import org.springframework.beans.factory.annotation.Autowired;

public class WidgetService {
    @Autowired
    private WidgetMapper widgetMapper;

    public Object find(String id) { return widgetMapper.selectById(id); }
    public void save(Object entity) { widgetMapper.insert(entity); }
}
