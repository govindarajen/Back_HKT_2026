#!/usr/bin/env python
"""
Test script for check_anomalie.py functionality
Tests both --siret and --ref modes
"""

import json
import subprocess
import sys
from pathlib import Path

script_dir = Path(__file__).parent
check_anomalie = script_dir / "check_anomalie.py"
python_exe = Path(".venv/Scripts/python.exe") if Path(".venv/Scripts/python.exe").exists() else "python"

def test_anomalie(mode, value):
    """Test check_anomalie.py with given mode and value"""
    print(f"\n{'='*60}")
    print(f"Testing: python check_anomalie.py {mode} {value}")
    print('='*60)
    
    try:
        result = subprocess.run(
            [str(python_exe), str(check_anomalie), mode, value],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        print(f"Return code: {result.returncode}")
        
        if result.stderr:
            print(f"STDERR: {result.stderr}")
        
        if result.stdout:
            try:
                result_obj = json.loads(result.stdout)
                print(f"Output: {json.dumps(result_obj, indent=2, ensure_ascii=False)}")
                
                # Handle both old (array) and new (object) formats
                if isinstance(result_obj, list):
                    print(f"Anomalies found: {len(result_obj)}")
                else:
                    anomalies = result_obj.get("anomalies", [])
                    print(f"Anomalies found: {len(anomalies)}")
                    if result_obj.get("validationMessage"):
                        print(f"Validation: {result_obj.get('validationMessage')}")
            except json.JSONDecodeError as e:
                print(f"JSON Parse Error: {e}")
                print(f"Raw output: {result.stdout}")
        
        return result.returncode == 0
        
    except subprocess.TimeoutExpired:
        print("TIMEOUT: Script took too long to execute")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False


if __name__ == "__main__":
    print("Testing check_anomalie.py functionality")
    
    # Test 1: By SIRET
    print("\n\nTest 1: Check by SIRET")
    test_anomalie("--siret", "60227680402501")
    
    # Test 2: By Reference
    print("\n\nTest 2: Check by Reference")
    test_anomalie("--ref", "0001-2025")
    
    # Test 3: Invalid mode
    print("\n\nTest 3: Invalid mode (should return empty)")
    test_anomalie("--invalid", "value")
    
    print("\n\n" + "="*60)
    print("Tests completed")
    print("="*60)
