package com.identityworksllc.iiq.plugins.rrp;

import com.identityworksllc.iiq.common.minimal.plugin.vo.RestObject;
import sailpoint.api.ObjectUtil;
import sailpoint.object.Application;
import sailpoint.object.Argument;
import sailpoint.object.AttributeDefinition;
import sailpoint.object.Bundle;
import sailpoint.object.ProvisioningPlan;
import sailpoint.object.ProvisioningProject;
import sailpoint.object.Rule;
import sailpoint.object.TaskResult;
import sailpoint.tools.Util;

import java.util.ArrayList;
import java.util.Map;
import java.util.HashMap;
import java.util.List;
import java.util.stream.Collectors;

public class RuleInformation extends RestObject {

    private String description;
    private String id;
    private List<String> libraries;
    private String name;
    private String source;
    private String type;
    private Map<String, Object> variables;

    public RuleInformation() {
        /* For JSON */
    }

    public RuleInformation(Rule sourceRule) {
        this.id = sourceRule.getId();
        this.name = sourceRule.getName();
        this.source = sourceRule.getSource();
        this.libraries = sourceRule.getReferencedRules() != null ?
                sourceRule.getReferencedRules().stream().map(rule -> rule.getName()).collect(Collectors.toList()) :
                new ArrayList<>();
        this.type = sourceRule.getType() != null ? sourceRule.getType().name() : null;
        this.description = sourceRule.getSignature() != null ? sourceRule.getSignature().getDescription() : null;
        if (sourceRule.getSignature() != null && sourceRule.getSignature().getArguments() != null) {
            this.variables = new HashMap<>();
            RuleRunnerResource.populateArguments(sourceRule.getSignature(), this.type, this.variables);
        }
    }

    public String getDescription() {
        return description;
    }

    public String getId() {
        return id;
    }

    public List<String> getLibraries() {
        return libraries;
    }

    public String getName() {
        return name;
    }

    public String getSource() {
        return source;
    }

    public String getType() {
        return type;
    }

    public Map<String, Object> getVariables() {
        return variables;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public void setId(String id) {
        this.id = id;
    }

    public void setLibraries(List<String> libraries) {
        this.libraries = libraries;
    }

    public void setName(String name) {
        this.name = name;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public void setType(String type) {
        this.type = type;
    }

    public void setVariables(Map<String, Object> variables) {
        this.variables = variables;
    }
}
